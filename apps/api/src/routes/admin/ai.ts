import type { Message, ToolCall, ToolDef } from "@loyaltyos/ai";
import { buildSystemPrompt, buildTools, OpenRouterClient } from "@loyaltyos/ai";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getRedisConnection } from "../../lib/queue.js";

// Tools that only read data — executed immediately, without operator
// confirmation. This is a whitelist: any tool NOT listed here (mutating or
// unknown) requires explicit operator confirmation. The server owns this list;
// it is never driven by the client.
export const READ_ONLY_TOOLS = new Set([
  "get_member",
  "list_members",
  "get_member_history",
  "list_campaigns",
  "get_campaign_stats",
  "preview_segment",
  "get_dashboard_analytics",
  "get_rewards_catalog",
  "get_program_config",
]);

// Mutating tools. Not used by the runtime gate (which is deny-by-default via
// READ_ONLY_TOOLS); kept explicit so the coverage test can assert every tool in
// packages/ai is classified into exactly one of these two categories.
export const MUTATION_TOOLS = new Set(["create_campaign", "create_segment", "create_coupon"]);

// How long a pending mutation confirmation stays valid before it must be
// re-requested. Prevents unbounded growth of orphaned confirmations.
const CONFIRMATION_TTL_SECONDS = 10 * 60;

interface PendingToolCall {
  adminId: string;
  programId: string;
  name: string;
  arguments: string;
}

function confirmationKey(toolCallId: string): string {
  return `ai:confirm:${toolCallId}`;
}

// Client messages are restricted to the two roles the user/assistant actually
// produce. `system` is rejected (the server owns the system prompt) and `tool`
// is rejected (the server rebuilds all tool results server-side, so a client
// cannot inject fabricated tool output). `tool_calls` is intentionally NOT in
// this schema: a client cannot submit tool calls (or their arguments) directly.
// Tool execution is driven entirely by what the server persisted at
// `mutation_required` time, keyed by the confirmed toolCallId.
const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    }),
  ),
  confirmedToolCallIds: z.array(z.string()).optional().default([]),
});

function createLoopbackFetch(apiKey: string, programId: string): typeof globalThis.fetch {
  return async (url, init) => {
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Program-Id": programId,
        ...init?.headers,
      },
    });
  };
}

async function executeTool(
  toolCall: ToolCall,
  tools: ToolDef[],
): Promise<{ content: string; error?: string }> {
  const handler = tools.find((t) => t.name === toolCall.function.name)?.handler;
  if (!handler) {
    const msg = `Unknown tool: ${toolCall.function.name}`;
    return { content: JSON.stringify({ error: msg }), error: msg };
  }

  try {
    const parsedArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    const result = await handler(parsedArgs);
    return { content: result };
  } catch (err) {
    const msg = (err as Error).message;
    return { content: JSON.stringify({ error: msg }), error: msg };
  }
}

export function adminAiRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/admin/ai/chat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.status(401).send({
          error: { code: "UNAUTHORIZED", message: "Admin authentication required" },
        });
      }

      // Fail-safe: disabled by default, and no fallback keys — if the feature
      // is not explicitly enabled or configured, refuse before opening a stream.
      if (process.env.AI_COMPANION_ENABLED !== "true") {
        return reply.status(404).send({
          error: { code: "AI_COMPANION_DISABLED", message: "AI companion is disabled" },
        });
      }

      const apiKey = process.env.LOYALTYOS_API_KEY;
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey || !openrouterKey) {
        return reply.status(503).send({
          error: { code: "AI_NOT_CONFIGURED", message: "AI companion is not configured" },
        });
      }

      const body = chatBodySchema.parse(request.body);

      const port = process.env.PORT_API ?? process.env.PORT ?? "3002";
      const baseUrl = `http://localhost:${String(port)}/api/v1`;

      const loopbackFetch = createLoopbackFetch(apiKey, request.programId);
      const tools = buildTools({ fetch: loopbackFetch, baseUrl });
      const toolDefs = tools.map((t: ToolDef) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));

      const systemPrompt = buildSystemPrompt({
        name: "LoyaltyOS",
        currency: "puntos",
        tiers: [],
        coalitionEnabled: false,
        coalitionProvider: null,
        activeMembers: 0,
        date: new Date().toISOString().split("T")[0] ?? "",
      });
      const systemMessage: Message = { role: "system", content: systemPrompt };

      const client = new OpenRouterClient({
        apiKey: openrouterKey,
        model: process.env.OPENROUTER_MODEL,
        appUrl: process.env.APP_URL ?? "http://localhost:5173",
      });

      const redis = getRedisConnection();

      // Phase 1 — confirmation round. The client only sends `confirmedToolCallIds`;
      // it never sends tool calls or their arguments. For each confirmed id we
      // atomically load-and-delete the call the server persisted earlier, verify
      // it belongs to this admin+program session, and reconstruct the tool call
      // from the SAVED arguments (never from the client). Any missing, expired,
      // or mismatched confirmation rejects the whole request with 409 and
      // executes nothing.
      const confirmedCalls: ToolCall[] = [];
      if (body.confirmedToolCallIds.length > 0) {
        if (!redis) {
          return reply.status(503).send({
            error: {
              code: "AI_CONFIRMATION_UNAVAILABLE",
              message: "Redis is required to confirm mutating tool calls",
            },
          });
        }

        for (const id of body.confirmedToolCallIds) {
          const stored = await redis.getdel(confirmationKey(id));
          if (!stored) {
            return reply.status(409).send({
              error: {
                code: "CONFIRMATION_INVALID",
                message: "La confirmación no existe o ha expirado",
              },
            });
          }

          let pending: PendingToolCall;
          try {
            pending = JSON.parse(stored) as PendingToolCall;
          } catch {
            return reply.status(409).send({
              error: {
                code: "CONFIRMATION_INVALID",
                message: "La confirmación no es válida",
              },
            });
          }

          if (pending.adminId !== request.adminId || pending.programId !== request.programId) {
            return reply.status(409).send({
              error: {
                code: "CONFIRMATION_INVALID",
                message: "La confirmación no pertenece a esta sesión",
              },
            });
          }

          confirmedCalls.push({
            id,
            type: "function",
            function: { name: pending.name, arguments: pending.arguments },
          });
        }
      }

      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let totalChars = 0;

      try {
        const MAX_ROUNDS = 5;
        let currentMessages: Message[] = [systemMessage, ...body.messages];

        // Reconstruct the assistant message (with tool_calls) and the tool
        // results server-side so the model sees the context of what was
        // confirmed and executed.
        if (confirmedCalls.length > 0) {
          const toolResults: Message[] = [];
          for (const toolCall of confirmedCalls) {
            const result = await executeTool(toolCall, tools);
            toolResults.push({
              role: "tool",
              content: result.content,
              tool_call_id: toolCall.id,
            });
            raw.write(
              `data: ${JSON.stringify(
                result.error
                  ? { type: "tool_error", error: result.error, toolCallId: toolCall.id }
                  : { type: "tool_result", content: result.content, toolCallId: toolCall.id },
              )}\n\n`,
            );
          }
          const assistantMessage: Message = {
            role: "assistant",
            content: "",
            tool_calls: confirmedCalls,
          };
          currentMessages = [...currentMessages, assistantMessage, ...toolResults];
        }

        // Phase 2 — stream from the model. Read-only tools execute immediately;
        // mutating tools are persisted to Redis and pause until the operator
        // confirms (the confirmation flows back through Phase 1).
        for (let round = 0; round < MAX_ROUNDS; round++) {
          let hasToolCalls = false;
          const toolResults: Message[] = [];
          const pendingToolCalls: ToolCall[] = [];

          const stream = client.streamChat(currentMessages, toolDefs);

          for await (const chunk of stream) {
            switch (chunk.type) {
              case "text":
                totalChars += (chunk.content ?? "").length;
                raw.write(`data: ${JSON.stringify({ type: "text", content: chunk.content })}\n\n`);
                break;

              case "tool_use":
                if (chunk.toolCall) {
                  const toolCall = chunk.toolCall;
                  hasToolCalls = true;

                  if (!READ_ONLY_TOOLS.has(toolCall.function.name)) {
                    if (!redis) {
                      raw.write(
                        `data: ${JSON.stringify({
                          type: "error",
                          error: "Confirmación no disponible (Redis no configurado)",
                        })}\n\n`,
                      );
                      raw.write("data: [DONE]\n\n");
                      raw.end();
                      return;
                    }

                    const pending: PendingToolCall = {
                      adminId: request.adminId,
                      programId: request.programId,
                      name: toolCall.function.name,
                      arguments: toolCall.function.arguments,
                    };
                    await redis.set(
                      confirmationKey(toolCall.id),
                      JSON.stringify(pending),
                      "EX",
                      CONFIRMATION_TTL_SECONDS,
                    );
                    raw.write(
                      `data: ${JSON.stringify({ type: "mutation_required", toolCall })}\n\n`,
                    );
                    raw.write("data: [DONE]\n\n");
                    raw.end();
                    return;
                  }

                  pendingToolCalls.push(toolCall);
                  raw.write(`data: ${JSON.stringify({ type: "tool_use", toolCall })}\n\n`);

                  const result = await executeTool(toolCall, tools);
                  toolResults.push({
                    role: "tool",
                    content: result.content,
                    tool_call_id: toolCall.id,
                  });
                  raw.write(
                    `data: ${JSON.stringify(
                      result.error
                        ? { type: "tool_error", error: result.error, toolCallId: toolCall.id }
                        : { type: "tool_result", content: result.content, toolCallId: toolCall.id },
                    )}\n\n`,
                  );
                }
                break;

              case "done":
                break;

              case "error":
                raw.write(`data: ${JSON.stringify({ type: "error", error: chunk.error })}\n\n`);
                break;
            }
          }

          if (!hasToolCalls) break;

          if (pendingToolCalls.length > 0) {
            const assistantMessage: Message = {
              role: "assistant",
              content: "",
              tool_calls: pendingToolCalls,
            };
            currentMessages = [...currentMessages, assistantMessage, ...toolResults];
          }
        }

        raw.write("data: [DONE]\n\n");
      } catch (err) {
        app.log.error({ err }, "AI proxy error");
        raw.write(
          `data: ${JSON.stringify({ type: "error", error: "Error interno del servidor" })}\n\n`,
        );
      } finally {
        raw.end();

        app.log.info(
          {
            adminId: request.adminId,
            programId: request.programId,
            messageCount: body.messages.length,
            outputChars: totalChars,
          },
          "AI chat request completed",
        );
      }
    },
  );

  done();
}

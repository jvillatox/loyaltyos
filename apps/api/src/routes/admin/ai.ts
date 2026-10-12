import type { Message, ToolCall, ToolDef } from "@loyaltyos/ai";
import { buildSystemPrompt, buildTools, OpenRouterClient } from "@loyaltyos/ai";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

// Tools that change state. The server owns this list: it is never driven by
// the client, and mutating tools are never executed without explicit operator
// confirmation (an id present in `confirmedToolCallIds`).
const MUTATION_TOOLS = new Set(["create_campaign", "create_segment", "create_coupon"]);

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

// Client messages are restricted to the two roles the user/assistant actually
// produce. `system` is rejected (the server owns the system prompt) and `tool`
// is rejected (the server rebuilds all tool results server-side, so a client
// cannot inject fabricated tool output).
const chatBodySchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      tool_calls: z.array(toolCallSchema).optional(),
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
      const confirmedSet = new Set(body.confirmedToolCallIds);

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

        // Phase 1 — confirmation round: the client re-sends the assistant
        // message carrying the tool calls the operator just confirmed. Execute
        // them server-side first, then feed the results back to the model.
        const lastMsg = currentMessages[currentMessages.length - 1];
        const pendingCalls: ToolCall[] =
          lastMsg?.role === "assistant" ? (lastMsg.tool_calls ?? []) : [];

        if (pendingCalls.length > 0) {
          const toolResults: Message[] = [];
          for (const toolCall of pendingCalls) {
            if (!confirmedSet.has(toolCall.id)) {
              raw.write(`data: ${JSON.stringify({ type: "mutation_required", toolCall })}\n\n`);
              raw.write("data: [DONE]\n\n");
              raw.end();
              return;
            }

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
          currentMessages = [...currentMessages, ...toolResults];
        }

        // Phase 2 — stream from the model, executing read tools immediately and
        // pausing on mutating tools until the operator confirms them.
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

                  if (
                    MUTATION_TOOLS.has(toolCall.function.name) &&
                    !confirmedSet.has(toolCall.id)
                  ) {
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

import type { Message, StreamChunk } from "./types.js";

interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  appUrl?: string;
}

interface Delta {
  role?: string;
  content?: string;
  tool_calls?: {
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }[];
}

interface Choice {
  index: number;
  delta: Delta;
  finish_reason: string | null;
}

interface StreamResponse {
  choices: Choice[];
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly appUrl: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "anthropic/claude-haiku-4-5";
    this.appUrl = config.appUrl ?? "";
  }

  async *streamChat(
    messages: Message[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
  ): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };

    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.appUrl,
        "X-Title": "LoyaltyOS Admin",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: "error", error: `OpenRouter error ${String(response.status)}: ${text}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: "error", error: "No response body" };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const parsed = JSON.parse(trimmed.slice(6)) as StreamResponse;
          for (const choice of parsed.choices) {
            const delta = choice.delta;

            // Text content
            if (delta.content) {
              yield { type: "text", content: delta.content };
            }

            // Tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCalls.get(tc.index);
                if (existing) {
                  if (tc.function?.arguments) {
                    existing.args += tc.function.arguments;
                  }
                } else if (tc.id) {
                  toolCalls.set(tc.index, {
                    id: tc.id,
                    name: tc.function?.name ?? "",
                    args: tc.function?.arguments ?? "",
                  });
                }
              }
            }

            if (choice.finish_reason === "tool_calls") {
              for (const [, tc] of toolCalls) {
                yield {
                  type: "tool_use",
                  toolCall: {
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: tc.args },
                  },
                };
              }
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    yield { type: "done" };
  }
}

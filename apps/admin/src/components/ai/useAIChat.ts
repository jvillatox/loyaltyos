import type { Message, ToolCall } from "@loyaltyos/ai";
import { useCallback, useRef, useState } from "react";

const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
const AI_PROXY_URL = `${API_URL}/admin/ai/chat`;

export interface ConfirmationRequest {
  toolCall: ToolCall;
  toolName: string;
  baseMessages: Message[];
}

interface ProxyChunk {
  type: string;
  content?: string;
  toolCall?: ToolCall;
  error?: string;
  toolCallId?: string;
}

async function* streamFromProxy(
  messages: Message[],
  signal: AbortSignal,
  confirmedToolCallIds?: string[],
): AsyncGenerator<ProxyChunk> {
  const body: Record<string, unknown> = {
    messages,
    confirmedToolCallIds: confirmedToolCallIds ?? [],
  };

  const response = await fetch(AI_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    let errorMsg = `Error del servidor (${String(response.status)})`;
    try {
      const errBody = (await response.json()) as { error?: { message: string } };
      if (errBody.error?.message) errorMsg = errBody.error.message;
    } catch {
      // keep default
    }
    yield { type: "error", error: errorMsg };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "error", error: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

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
        const parsed = JSON.parse(trimmed.slice(6)) as ProxyChunk;
        yield parsed;
      } catch {
        // skip malformed JSON
      }
    }
  }
}

export function useAIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return;

      const userMessage: Message = { role: "user", content: text };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let assistantContent = "";

      try {
        const stream = streamFromProxy(updatedMessages, controller.signal);

        for await (const chunk of stream) {
          if (controller.signal.aborted) break;

          switch (chunk.type) {
            case "text":
              assistantContent += chunk.content ?? "";
              setMessages([...updatedMessages, { role: "assistant", content: assistantContent }]);
              break;

            case "mutation_required": {
              if (!chunk.toolCall) break;
              const toolCall = chunk.toolCall;

              setPendingConfirmation({
                toolCall,
                toolName: toolCall.function.name,
                baseMessages: updatedMessages,
              });
              setIsStreaming(false);
              return;
            }

            case "tool_use":
            case "tool_result":
            case "tool_error":
              // Server handles tool execution — UI can optionally show indicator
              break;

            case "error":
              assistantContent += `\n\n❌ ${chunk.error ?? "Error desconocido"}`;
              setMessages([...updatedMessages, { role: "assistant", content: assistantContent }]);
              break;
          }
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content === assistantContent) {
            return prev;
          }
          return [...prev, { role: "assistant", content: assistantContent }];
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setMessages([
            ...updatedMessages,
            {
              role: "assistant",
              content: `❌ Error: ${(err as Error).message}`,
            },
          ]);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming],
  );

  const confirmAction = useCallback(async () => {
    if (!pendingConfirmation) return;

    const { toolCall, baseMessages } = pendingConfirmation;
    setPendingConfirmation(null);
    setIsStreaming(true);

    const assistantToolCallMessage: Message = {
      role: "assistant",
      content: "",
      tool_calls: [toolCall],
    };
    const allMessages: Message[] = [...baseMessages, assistantToolCallMessage];

    const controller = new AbortController();
    abortRef.current = controller;
    let continuedContent = "";

    try {
      const stream = streamFromProxy(allMessages, controller.signal, [toolCall.id]);

      for await (const chunk of stream) {
        if (controller.signal.aborted) break;

        if (chunk.type === "text") {
          continuedContent += chunk.content ?? "";
          setMessages([...baseMessages, { role: "assistant", content: continuedContent }]);
        } else if (chunk.type === "error") {
          continuedContent += `\n\n❌ ${chunk.error ?? "Error desconocido"}`;
          setMessages([...baseMessages, { role: "assistant", content: continuedContent }]);
        }
      }

      setMessages([...baseMessages, { role: "assistant", content: continuedContent }]);
    } catch (err) {
      if (!controller.signal.aborted) {
        setMessages([
          ...baseMessages,
          {
            role: "assistant",
            content: `❌ Error: ${(err as Error).message}`,
          },
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [pendingConfirmation]);

  const cancelAction = useCallback(() => {
    setPendingConfirmation(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "Operación cancelada." }]);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setPendingConfirmation(null);
  }, []);

  return {
    messages,
    isStreaming,
    pendingConfirmation,
    sendMessage,
    confirmAction,
    cancelAction,
    clearHistory,
  } as const;
}

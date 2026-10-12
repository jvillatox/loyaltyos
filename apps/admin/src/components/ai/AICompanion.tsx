import { AlertTriangle, Check, MessageSquare, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { MessageBubble } from "./MessageBubble";
import type { ConfirmationRequest } from "./useAIChat";
import { useAIChat } from "./useAIChat";

const ENABLED: boolean =
  (import.meta.env.VITE_AI_COMPANION_ENABLED as string | undefined) === "true";

const SUGGESTED_PROMPTS = [
  "¿Cómo está el programa esta semana?",
  "Crea una campaña de puntos dobles para este fin de semana",
  "Busca los 10 miembros con mayor saldo",
  "¿Cuántos clientes llevan más de 60 días sin comprar?",
];

export function AICompanion(): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");

  const {
    messages,
    isStreaming,
    pendingConfirmation,
    sendMessage,
    confirmAction,
    cancelAction,
    clearHistory,
  } = useAIChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!ENABLED) return null;

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    void sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    void sendMessage(prompt);
  };

  return (
    <>
      {/* FAB toggle button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center",
          "rounded-full bg-primary text-primary-foreground shadow-lg",
          "hover:bg-primary/90 transition-all duration-200",
          "hover:scale-105 active:scale-95",
          isOpen && "rotate-90",
        )}
        aria-label={isOpen ? "Cerrar chat" : "Abrir chat"}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {/* Slide-over panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-40 h-full w-[420px] border-l bg-background shadow-2xl",
          "flex flex-col transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">LoyaltyOS Assistant</h2>
              <p className="text-xs text-muted-foreground">
                {isStreaming ? "Escribiendo..." : "En línea"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={clearHistory}
                title="Limpiar historial"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">LoyaltyOS Assistant</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Pregúntame sobre tu programa de fidelización. Puedo analizar datos, crear campañas
                  y ayudarte a optimizar resultados.
                </p>
              </div>
              <div className="grid gap-2 w-full max-w-xs">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="outline"
                    size="sm"
                    className="text-xs h-auto py-2 px-3 justify-start text-left font-normal"
                    onClick={() => {
                      handleSuggestedPrompt(prompt);
                    }}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={`${msg.role}-${String(i)}`}
                  message={msg}
                  isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                />
              ))}
              {isStreaming && messages[messages.length - 1]?.role === "user" && (
                <MessageBubble message={{ role: "assistant", content: "" }} isStreaming />
              )}
            </div>
          )}
        </div>

        {/* Confirmation card */}
        {pendingConfirmation && (
          <ConfirmationCard
            confirmation={pendingConfirmation}
            onConfirm={() => {
              void confirmAction();
            }}
            onCancel={cancelAction}
          />
        )}

        {/* Input */}
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta sobre tu programa..."
              className="min-h-[44px] max-h-[120px] resize-none text-sm"
              rows={1}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {isStreaming ? "Procesando..." : "Cmd+Enter para enviar"}
          </p>
        </div>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 transition-opacity"
          onClick={() => {
            setIsOpen(false);
          }}
        />
      )}
    </>
  );
}

function ConfirmationCard({
  confirmation,
  onConfirm,
  onCancel,
}: {
  confirmation: ConfirmationRequest;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="border-t bg-yellow-50 dark:bg-yellow-950/20 p-4">
      <Card className="p-4 border-yellow-300 dark:border-yellow-800">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Confirmar acción</p>
            <p className="text-xs text-muted-foreground mt-1">
              Se ejecutará <strong>{confirmation.toolName}</strong> con los parámetros
              proporcionados. Esta acción no se puede deshacer automáticamente.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5 mr-1" />
            Cancelar
          </Button>
          <Button size="sm" onClick={onConfirm}>
            <Check className="h-3.5 w-3.5 mr-1" />
            Confirmar
          </Button>
        </div>
      </Card>
    </div>
  );
}

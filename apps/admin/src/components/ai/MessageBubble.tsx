import type { Message } from "@loyaltyos/ai";
import { Bot, User } from "lucide-react";

import { cn } from "../../lib/utils";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

function renderContent(content: string): string {
  return (
    content
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code class='bg-muted px-1 py-0.5 rounded text-sm'>$1</code>")
      // Line breaks
      .replace(/\n/g, "<br>")
  );
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) return <></>;

  return (
    <div className={cn("flex gap-3 mb-4", isUser && "justify-end")}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none [&>strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: renderContent(message.content) }}
          />
        )}

        {isStreaming && !isUser && (
          <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <User className="w-4 h-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

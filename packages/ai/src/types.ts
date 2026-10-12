export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface StreamChunk {
  type: "text" | "tool_use" | "done" | "error";
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

export interface ProgramContext {
  name: string;
  currency: string;
  tiers: { name: string; minPoints: number; benefits: string[] }[];
  coalitionEnabled: boolean;
  coalitionProvider: string | null;
  activeMembers: number;
  date: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface ChatResponse {
  message: Message;
  toolCalls?: ToolCall[];
}

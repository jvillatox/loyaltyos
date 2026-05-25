import { McpToolError } from "./errors.js";

export function validateApiKey(providedKey: string | undefined, expectedKey: string): void {
  if (!providedKey || providedKey !== expectedKey) {
    throw new McpToolError("Invalid or missing MCP API key", "UNAUTHORIZED");
  }
}

export function extractApiKeyFromHeaders(headers: Record<string, string>): string | undefined {
  const authHeader = headers.authorization ?? headers.Authorization ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : undefined;
}

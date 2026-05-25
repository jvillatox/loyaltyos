export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "VALIDATION" | "UPSTREAM_ERROR" | "UNAUTHORIZED",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

export function mapAxiosError(error: unknown): never {
  if (error instanceof McpToolError) throw error;

  const isAxios = (
    e: unknown,
  ): e is { response?: { status: number; data?: { message?: string } } } =>
    typeof e === "object" && e !== null && "response" in e;

  if (isAxios(error)) {
    const status = error.response?.status ?? 500;
    const msg = error.response?.data?.message ?? "Upstream API error";

    if (status === 404) {
      throw new McpToolError(msg, "NOT_FOUND");
    }
    if (status === 401 || status === 403) {
      throw new McpToolError(msg, "UNAUTHORIZED");
    }
    if (status >= 400 && status < 500) {
      throw new McpToolError(msg, "VALIDATION");
    }
    throw new McpToolError(msg, "UPSTREAM_ERROR");
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  throw new McpToolError(message, "UPSTREAM_ERROR");
}

export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "VALIDATION"
      | "UPSTREAM_ERROR"
      | "UNAUTHORIZED"
      | "FORBIDDEN",
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
  ): e is {
    response?: { status: number; data?: { error?: { code?: string; message?: string } } };
  } => typeof e === "object" && e !== null && "response" in e;

  if (isAxios(error)) {
    const status = error.response?.status ?? 500;
    const code = error.response?.data?.error?.code;
    const message = error.response?.data?.error?.message ?? code ?? "Upstream API error";

    if (status === 404) {
      throw new McpToolError(message, "NOT_FOUND");
    }
    if (status === 401) {
      throw new McpToolError(code ?? "UNAUTHORIZED", "UNAUTHORIZED");
    }
    if (status === 403) {
      // Surface the upstream code ("FORBIDDEN") rather than a generic message so
      // callers can tell a permission denial apart from an upstream/server error.
      throw new McpToolError(code ?? "FORBIDDEN", "FORBIDDEN");
    }
    if (status >= 400 && status < 500) {
      throw new McpToolError(message, "VALIDATION");
    }
    throw new McpToolError(message, "UPSTREAM_ERROR");
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  throw new McpToolError(message, "UPSTREAM_ERROR");
}

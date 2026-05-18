import type { WidgetConfig } from "../types.js";

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchApi<T>(
  config: WidgetConfig,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${config.apiUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      "X-Program-Id": config.programId,
      ...options.headers,
    },
  });

  const body = (await response.json()) as { data?: T; error?: { code: string; message: string } };

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? `Request failed with status ${String(response.status)}`,
    );
  }

  return body.data as T;
}

export async function postApi<T>(
  config: WidgetConfig,
  path: string,
  data: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return fetchApi<T>(config, path, {
    method: "POST",
    body: JSON.stringify(data),
    headers,
  });
}

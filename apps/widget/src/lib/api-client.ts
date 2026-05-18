import type { WidgetConfig } from "../types.js";

export class ApiError extends Error {
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
  const url = `${config.apiBase}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Program-Id": config.programId,
    ...(options.headers as Record<string, string> | undefined),
  };

  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("loyaltyos:auth-required"));
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }

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
  const customHeaders: Record<string, string> = {};
  if (idempotencyKey) {
    customHeaders["Idempotency-Key"] = idempotencyKey;
  }

  return fetchApi<T>(config, path, {
    method: "POST",
    body: JSON.stringify(data),
    headers: customHeaders,
  });
}

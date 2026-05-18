const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem("auth-token");
  const programId = sessionStorage.getItem("program-id") ?? "prog_001";

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Program-Id": programId,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (response.status === 401) {
    sessionStorage.removeItem("auth-token");
    window.dispatchEvent(new CustomEvent("loyaltyos:auth-required"));
    throw new ApiError(401, "Session expired");
  }

  const body = (await response.json()) as { data?: T; error?: { message: string } };
  if (!response.ok) {
    throw new ApiError(response.status, body.error?.message ?? `Request failed`);
  }

  return body.data as T;
}

export async function postApi<T>(path: string, data: unknown): Promise<T> {
  return fetchApi<T>(path, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

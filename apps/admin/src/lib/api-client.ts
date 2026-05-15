const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
const API_KEY: string = (import.meta.env.VITE_API_KEY as string | undefined) ?? "dev-key";
const PROGRAM_ID: string = (import.meta.env.VITE_PROGRAM_ID as string | undefined) ?? "prog_dev";

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

export async function fetchApi<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      "X-Program-Id": PROGRAM_ID,
      ...options?.headers,
    },
  });

  const body = (await response.json()) as { error?: { message: string }; data: T };

  if (!response.ok) {
    throw new Error(body.error?.message ?? `Request failed with status ${String(response.status)}`);
  }

  return body.data;
}

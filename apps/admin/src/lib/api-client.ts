const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
const API_KEY: string = (import.meta.env.VITE_API_KEY as string | undefined) ?? "dev-key";
const PROGRAM_ID: string = (import.meta.env.VITE_PROGRAM_ID as string | undefined) ?? "prog_dev";

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

let adminCredentialMode = false;

export function isAdminAuthenticated(): boolean {
  return adminCredentialMode;
}

export async function adminLogin(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`${API_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });

  const body = (await response.json()) as {
    data?: unknown;
    error?: { message: string };
  };

  if (!response.ok) {
    return { ok: false, error: body.error?.message ?? "Login failed" };
  }

  adminCredentialMode = true;
  return { ok: true };
}

export async function adminLogout(): Promise<void> {
  await fetch(`${API_URL}/admin/logout`, {
    method: "POST",
    credentials: "include",
  });
  adminCredentialMode = false;
  window.location.href = "/login";
}

export async function fetchApi<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  // In admin credential mode, rely on cookies, not API key
  if (!adminCredentialMode) {
    headers["X-API-Key"] = API_KEY;
    headers["X-Program-Id"] = PROGRAM_ID;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: adminCredentialMode ? "include" : "omit",
  });

  const body = (await response.json()) as { error?: { message: string }; data: T };

  if (!response.ok) {
    // If admin session expired, redirect to login
    if (response.status === 401 && adminCredentialMode) {
      adminCredentialMode = false;
      window.location.href = "/login";
    }
    throw new Error(body.error?.message ?? `Request failed with status ${String(response.status)}`);
  }

  return body.data;
}

const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  locale: string | null;
  programId: string;
}

// Registered by the admin auth provider. Any 401 response clears the session
// and redirects to /login. The /admin/me probe (fetchAdminMe) bypasses this so
// an anonymous initial load does not trigger a redirect loop.
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function fetchApi<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  // Admin authentication is exclusively the session cookie — no API key is
  // sent, and none may be embedded in the production bundle.
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const body = (await response.json()) as {
    data?: T;
    error?: { message?: string; code?: string };
  };

  if (!response.ok) {
    if (response.status === 401) {
      onUnauthorized?.();
    }
    throw new Error(body.error?.message ?? `Request failed with status ${String(response.status)}`);
  }

  return body.data as T;
}

export async function fetchAdminMe(): Promise<AdminUser | null> {
  const response = await fetch(`${API_URL}/admin/me`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  const body = (await response.json()) as { data?: AdminUser };
  if (!response.ok) {
    return null;
  }
  return body.data ?? null;
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
    data?: { admin?: unknown };
    error?: { message: string };
  };

  if (!response.ok) {
    return { ok: false, error: body.error?.message ?? "Login failed" };
  }

  return { ok: true };
}

export async function adminLogout(): Promise<void> {
  await fetch(`${API_URL}/admin/logout`, {
    method: "POST",
    credentials: "include",
  });
}

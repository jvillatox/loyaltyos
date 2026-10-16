// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchApi, setOnUnauthorized } from "../api-client";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setOnUnauthorized(null);
});

describe("fetchApi", () => {
  it("sends the session cookie and no API key", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }, 200));
    vi.stubGlobal("fetch", mockFetch);

    await fetchApi<{ ok: boolean }>("/admin/campaigns");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/campaigns");
    expect(init.credentials).toBe("include");
    const headers = init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("X-API-Key");
    expect(headers).not.toHaveProperty("X-Program-Id");
  });

  it("invokes the unauthorized handler on 401", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "unauthorized" } }, 401));
    vi.stubGlobal("fetch", mockFetch);
    const onUnauthorized = vi.fn();
    setOnUnauthorized(onUnauthorized);

    await expect(fetchApi("/admin/campaigns")).rejects.toThrow("unauthorized");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

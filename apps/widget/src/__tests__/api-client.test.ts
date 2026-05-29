import { describe, expect, it, vi } from "vitest";

import { fetchApi, postApi } from "../lib/api-client.js";
import type { WidgetConfig } from "../types.js";

const config: WidgetConfig = {
  programId: "test-program-id",
  apiBase: "https://api.example.com",
  authToken: "test-token",
  theme: "light",
  accentColor: "#7c3aed",
  locale: "en-US",
  compact: false,
  mode: "full",
};

describe("fetchApi", () => {
  it("unwraps the { data } envelope on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { id: "1", name: "Test" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await fetchApi<{ id: string; name: string }>(config, "/test");

    expect(result).toEqual({ id: "1", name: "Test" });
  });

  it("sends Authorization Bearer and X-Program-Id headers", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchApi(config, "/test");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Program-Id"]).toBe("test-program-id");
  });

  it("uses the configured API URL", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchApi(config, "/rewards?page=1");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.example.com/rewards?page=1");
  });

  it("dispatches loyaltyos:auth-required on 401", async () => {
    let eventDispatched = false;
    window.addEventListener("loyaltyos:auth-required", () => {
      eventDispatched = true;
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }),
        ),
    );

    await expect(fetchApi(config, "/test")).rejects.toThrow("Authentication required");
    expect(eventDispatched).toBe(true);
  });

  it("throws on non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "NOT_FOUND", message: "Resource not found" } }),
            { status: 404 },
          ),
        ),
    );

    await expect(fetchApi(config, "/test")).rejects.toThrow("Resource not found");
  });
});

describe("postApi", () => {
  it("sends POST with JSON body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await postApi(config, "/submit", { key: "value" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ key: "value" });
  });

  it("sends Idempotency-Key header when provided", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await postApi(config, "/submit", {}, "idem-123");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem-123");
  });
});

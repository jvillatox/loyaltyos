import { describe, expect, it, vi } from "vitest";

import { fetchApi, postApi } from "../lib/api-client.js";
import type { WidgetConfig } from "../types.js";

const config: WidgetConfig = {
  apiKey: "test-api-key",
  apiUrl: "https://api.example.com",
  programId: "test-program-id",
  memberId: "test-member-id",
};

describe("fetchApi", () => {
  it("unwraps the { data } envelope on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "1", name: "Test" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchApi<{ id: string; name: string }>(config, "/test");

    expect(result).toEqual({ id: "1", name: "Test" });
  });

  it("sends X-API-Key and X-Program-Id headers", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchApi(config, "/test");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "X-API-Key": "test-api-key",
      "X-Program-Id": "test-program-id",
    });
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

  it("throws on non-2xx responses", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "NOT_FOUND", message: "Resource not found" } }),
          { status: 404 },
        ),
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchApi(config, "/test")).rejects.toThrow("Resource not found");
  });

  it("passes through custom request options", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchApi(config, "/test", { method: "DELETE" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
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
    expect(init.headers).toHaveProperty("Idempotency-Key", "idem-123");
  });
});

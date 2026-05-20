import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoalitionBusinessError, CoalitionTransientError } from "../../types.js";
import { createApprecioAdapter } from "../apprecio.js";
import type { ApprecioConfig } from "../apprecio.types.js";
import { ApprecioConfigError } from "../apprecio.types.js";

// ── Helpers ─────────────────────────────────────────────────────

const CONFIG: ApprecioConfig = {
  apiBase: "https://apiv2.dcanje.mx/api",
  publicToken: "pub-token-123",
  privateToken: "priv-secret-456",
  identifierType: "email",
};

function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

// ── Tests ──────────────────────────────────────────────────────

describe("createApprecioAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  // ═══ MD5 Hash ═══

  describe("signature generation", () => {
    it("generates correct MD5 hash from ts + public_token + private_token", async () => {
      const ts = "1234567890";
      const expected = crypto
        .createHash("md5")
        .update(ts + CONFIG.publicToken + CONFIG.privateToken)
        .digest("hex");

      // The hash is generated internally; we verify it matches the form body
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.hash).toBe(expected);
        expect(parsed.hash).toHaveLength(32); // MD5 hex is 32 chars
        return { status: 200, json: () => Promise.resolve({ success: true }) };
      });

      const adapter = createApprecioAdapter(CONFIG);
      await adapter.accumulate("user@test.com", 100, ts);
    });

    it("hash never contains private_token", () => {
      const ts = "1234567890";
      const hash = crypto
        .createHash("md5")
        .update(ts + CONFIG.publicToken + CONFIG.privateToken)
        .digest("hex");

      expect(hash).not.toContain(CONFIG.privateToken);
    });
  });

  // ═══ Accumulate ═══

  describe("accumulate", () => {
    it("sends carga_directa_email with email, asignado, and descripcion", async () => {
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.accion).toBe("carga_directa_email");
        expect(parsed.email).toBe("user@test.com");
        expect(parsed.asignado).toBe("100");
        expect(parsed.descripcion).toBe("LoyaltyOS coalition transaction");
        expect(parsed.public_token).toBe(CONFIG.publicToken);
        expect(parsed.ts).toBe("tx-acc-1");
        expect(parsed.tipo).toBe("JSON");
        return {
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { saldo_actual: 500, transaction_id: "ext-1" },
            }),
        };
      });

      const adapter = createApprecioAdapter(CONFIG);
      const result = await adapter.accumulate("user@test.com", 100, "tx-acc-1");

      expect(result.externalTxId).toBe("tx-acc-1");
      expect(result.balanceAfter).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sends acumular_puntos with rut when identifierType is rut", async () => {
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.accion).toBe("acumular_puntos");
        expect(parsed.rut).toBe("15245874K");
        expect(parsed.asignado).toBe("50");
        return {
          status: 200,
          json: () => Promise.resolve({ success: true, data: { saldo_actual: 200 } }),
        };
      });

      const adapter = createApprecioAdapter({
        ...CONFIG,
        identifierType: "rut",
      });
      const result = await adapter.accumulate("15245874K", 50, "tx-rut");

      expect(result.externalTxId).toBe("tx-rut");
    });

    it("throws ConfigError when identifierType is email but ref is not an email", async () => {
      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.accumulate("not-an-email", 100, "tx-bad")).rejects.toThrow(
        ApprecioConfigError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ═══ Get Balance ═══

  describe("getBalance", () => {
    it("calls saldo_usuario_email and returns balance", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ success: true, data: { saldo: 1500 } }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      const balance = await adapter.getBalance("user@test.com");

      expect(balance).toBe(1500);
    });

    it("calls saldo_usuario when identifierType is rut", async () => {
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.accion).toBe("saldo_usuario");
        expect(parsed.rut).toBe("15245874K");
        return {
          status: 200,
          json: () => Promise.resolve({ success: true, data: { saldo: 800 } }),
        };
      });

      const adapter = createApprecioAdapter({ ...CONFIG, identifierType: "rut" });
      const balance = await adapter.getBalance("15245874K");

      expect(balance).toBe(800);
    });

    it("returns 0 when data.saldo is missing", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ success: true, data: {} }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      const balance = await adapter.getBalance("user@test.com");

      expect(balance).toBe(0);
    });
  });

  // ═══ Query History ═══

  describe("queryHistory", () => {
    it("calls historialCarga with date range", async () => {
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.accion).toBe("historialCarga");
        expect(parsed.date_start).toBe("2026-01-01");
        expect(parsed.date_end).toBe("2026-01-31");
        return {
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: [{ id: "h1", puntos: 100 }],
            }),
        };
      });

      const adapter = createApprecioAdapter(CONFIG);
      const history = await adapter.queryHistory?.(
        "user@test.com",
        new Date("2026-01-01"),
        new Date("2026-01-31"),
      );

      expect(history).toHaveLength(1);
    });
  });

  // ═══ Convert ═══

  describe("convert", () => {
    it("maps convert to accumulate (carga_directa_email)", async () => {
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.accion).toBe("carga_directa_email");
        expect(parsed.asignado).toBe("300");
        return {
          status: 200,
          json: () => Promise.resolve({ success: true, data: { saldo_actual: 1000 } }),
        };
      });

      const adapter = createApprecioAdapter(CONFIG);
      const result = await adapter.convert?.("user@test.com", 300, "cnv-1");

      expect(result?.externalTxId).toBe("cnv-1");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ═══ Capabilities ═══

  describe("capabilities", () => {
    it("has correct capabilities reflecting Apprecio API limits", () => {
      const adapter = createApprecioAdapter(CONFIG);

      expect(adapter.capabilities).toEqual({
        accumulate: true,
        redeem: false,
        convert: true,
        reverseTransaction: false,
        historyQuery: true,
      });
    });
  });

  // ═══ Unsupported Methods ═══

  describe("unsupported methods", () => {
    it("redeem is undefined (no network call)", () => {
      const adapter = createApprecioAdapter(CONFIG);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(adapter.redeem).toBeUndefined();
    });

    it("reverseTransaction is undefined (no network call)", () => {
      const adapter = createApprecioAdapter(CONFIG);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(adapter.reverseTransaction).toBeUndefined();
    });
  });

  // ═══ Error Mapping ═══

  describe("error mapping", () => {
    it("throws CoalitionBusinessError on HTTP 401 (no retry)", async () => {
      fetchMock.mockResolvedValue({
        status: 401,
        json: () => Promise.resolve({ message: "Invalid public_token" }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(CoalitionBusinessError);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(/Invalid public_token/);
    });

    it("throws CoalitionBusinessError on HTTP 403 (no retry)", async () => {
      fetchMock.mockResolvedValue({
        status: 403,
        json: () => Promise.resolve({ message: "Forbidden" }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(CoalitionBusinessError);
    });

    it("throws CoalitionTransientError on HTTP 500 (will retry)", async () => {
      fetchMock.mockResolvedValue({
        status: 500,
        json: () => Promise.resolve({ message: "Internal error" }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(CoalitionTransientError);
    });

    it("throws CoalitionTransientError on network timeout", async () => {
      fetchMock.mockRejectedValue(new Error("The operation was aborted"));

      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(CoalitionTransientError);
    });

    it("throws CoalitionBusinessError on HTTP 2xx with success:false", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        json: () =>
          Promise.resolve({
            success: false,
            message: "User not found in program",
          }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(CoalitionBusinessError);
      await expect(adapter.getBalance("user@test.com")).rejects.toThrow(/User not found/);
    });

    it("throws CoalitionBusinessError on HTTP 2xx with error field", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ error: "Insufficient balance" }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      await expect(adapter.accumulate("user@test.com", 100, "tx-e1")).rejects.toThrow(
        CoalitionBusinessError,
      );
    });
  });

  // ═══ Sanitization ═══

  describe("token sanitization", () => {
    it("private_token never appears in error messages", async () => {
      fetchMock.mockResolvedValue({
        status: 500,
        json: () => Promise.resolve({ message: "Server error" }),
      });

      const adapter = createApprecioAdapter(CONFIG);

      try {
        await adapter.getBalance("user@test.com");
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        expect(message).not.toContain(CONFIG.privateToken);
        // The hash should also not appear in plain text
        expect(message).not.toContain("hash");
      }

      // Also verify the request body doesn't contain private_token
      const calls = fetchMock.mock.calls as [string, { body?: string }][];
      if (calls.length > 0) {
        const body = calls[0]?.[1]?.body ?? "";
        expect(body).not.toContain(CONFIG.privateToken);
      }
    });

    it("public_token IS sent in the request body", async () => {
      fetchMock.mockImplementation((_url: string, init: { body?: string }) => {
        const parsed = parseFormBody(init.body ?? "");
        expect(parsed.public_token).toBe(CONFIG.publicToken);
        return {
          status: 200,
          json: () => Promise.resolve({ success: true, data: { saldo: 100 } }),
        };
      });

      const adapter = createApprecioAdapter(CONFIG);
      await adapter.getBalance("user@test.com");
    });
  });

  // ═══ Healthcheck ═══

  describe("healthcheck", () => {
    it("returns ok:true with latency on success", async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ success: true, data: { saldo: 0 } }),
      });

      const adapter = createApprecioAdapter(CONFIG);
      const result = await adapter.healthcheck();

      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns ok:false on failure", async () => {
      fetchMock.mockRejectedValue(new Error("Connection refused"));

      const adapter = createApprecioAdapter(CONFIG);
      const result = await adapter.healthcheck();

      expect(result.ok).toBe(false);
      expect(result.details).toBeDefined();
    });
  });
});

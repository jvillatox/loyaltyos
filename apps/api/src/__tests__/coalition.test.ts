import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock prisma (only auth models needed) ─────────────────────────

const mockPrisma = vi.hoisted(() => ({
  apiKey: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));

// ── Mock coalition service ────────────────────────────────────────

const mockCoalitionService = vi.hoisted(() => ({
  accumulate: vi.fn(),
  redeem: vi.fn(),
  convert: vi.fn(),
  reverseCoalitionTransaction: vi.fn(),
  getExternalBalance: vi.fn(),
  getExternalHistory: vi.fn(),
  linkExternalAccount: vi.fn(),
  unlinkExternalAccount: vi.fn(),
  getAdapterCapabilities: vi.fn(),
  listTransactions: vi.fn(),
}));

const mockGetCachedExternalBalance = vi.hoisted(() => vi.fn());

vi.mock("../lib/coalition-setup.js", () => ({
  coalitionService: mockCoalitionService,
  getCachedExternalBalance: mockGetCachedExternalBalance,
}));

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";

let app: FastifyInstance;

const authHeaders = {
  "x-api-key": "test-api-key",
  "x-program-id": "prog-1",
};

const idempotencyKey = { "idempotency-key": "idem-test-123" };

beforeEach(async () => {
  vi.clearAllMocks();

  // Default auth mock
  mockPrisma.apiKey.findUnique.mockResolvedValue({
    id: "key-1",
    programId: "prog-1",
    key: "test-api-key",
    scope: "admin",
    isActive: true,
    name: "Test Key",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockPrisma.apiKey.update.mockResolvedValue({});

  app = await buildApp({ logger: false });

  app.addHook("onRequest", async (request) => {
    request.programId = (request.headers["x-program-id"] as string) || "prog-1";
    request.apiKeyScope = (request.headers["x-api-scope"] as string) || "admin";
  });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("Coalition API routes", () => {
  // ═══ Accumulate ═══

  describe("POST /coalition/accumulate", () => {
    it("returns 201 on successful dual accumulation", async () => {
      mockCoalitionService.accumulate.mockResolvedValue({
        txId: "tx-1",
        externalTxId: "ext-1",
        status: "CONFIRMED",
        balanceAfter: 500,
        idempotent: false,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/accumulate",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          points: 100,
          txRef: "tx-acc-1",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ data: { externalTxId: string; balanceAfter: number } }>();
      expect(body.data.externalTxId).toBe("ext-1");
      expect(body.data.balanceAfter).toBe(500);
    });

    it("returns 400 when idempotency-key header is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/accumulate",
        headers: authHeaders,
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          points: 100,
          txRef: "tx-acc-1",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("MISSING_HEADER");
    });

    it("returns 200 when transaction is idempotent", async () => {
      mockCoalitionService.accumulate.mockResolvedValue({
        txId: "tx-existing",
        externalTxId: "ext-1",
        status: "CONFIRMED",
        idempotent: true,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/accumulate",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          points: 100,
          txRef: "tx-acc-1",
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ═══ Redeem ═══

  describe("POST /coalition/redeem", () => {
    it("returns 201 on successful redeem", async () => {
      mockCoalitionService.redeem.mockResolvedValue({
        txId: "tx-red-1",
        externalTxId: "ext-red-1",
        status: "CONFIRMED",
        balanceAfter: 400,
        idempotent: false,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/redeem",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          points: 100,
          txRef: "tx-red-1",
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it("returns 501 when adapter does not support redeem", async () => {
      const { CoalitionUnsupportedError } = await import("@loyaltyos/coalition");
      mockCoalitionService.redeem.mockRejectedValue(
        new CoalitionUnsupportedError("redeem", "apprecio"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/redeem",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          points: 100,
          txRef: "tx-red-2",
        },
      });

      expect(res.statusCode).toBe(501);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("UNSUPPORTED_OPERATION");
    });
  });

  // ═══ Convert ═══

  describe("POST /coalition/convert", () => {
    it("returns 201 on successful convert", async () => {
      mockCoalitionService.convert.mockResolvedValue({
        txId: "tx-cnv-1",
        externalTxId: "ext-cnv-1",
        status: "CONFIRMED",
        balanceAfter: 1000,
        idempotent: false,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/convert",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          ownPoints: 500,
          txRef: "cnv-1",
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it("returns 422 when minConversionPoints is not met", async () => {
      const { CoalitionBusinessError } = await import("@loyaltyos/coalition");
      mockCoalitionService.convert.mockRejectedValue(
        new CoalitionBusinessError("Minimum conversion is 500 points"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/convert",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          ownPoints: 100,
          txRef: "cnv-2",
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("COALITION_BUSINESS_ERROR");
    });

    it("returns 501 when convert is not supported by adapter", async () => {
      const { CoalitionUnsupportedError } = await import("@loyaltyos/coalition");
      mockCoalitionService.convert.mockRejectedValue(
        new CoalitionUnsupportedError("convert", "apprecio"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/convert",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
          ownPoints: 1000,
          txRef: "cnv-3",
        },
      });

      expect(res.statusCode).toBe(501);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("UNSUPPORTED_OPERATION");
    });
  });

  // ═══ Reverse ═══

  describe("POST /coalition/reverse", () => {
    it("returns 200 on successful reverse", async () => {
      mockCoalitionService.reverseCoalitionTransaction.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/reverse",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          txRef: "tx-acc-1",
          reason: "Customer refund",
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it("returns 501 when reverse is not supported", async () => {
      const { CoalitionUnsupportedError } = await import("@loyaltyos/coalition");
      mockCoalitionService.reverseCoalitionTransaction.mockRejectedValue(
        new CoalitionUnsupportedError("reverseTransaction", "apprecio"),
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/coalition/reverse",
        headers: { ...authHeaders, ...idempotencyKey },
        payload: {
          txRef: "tx-acc-1",
          reason: "Customer refund",
        },
      });

      expect(res.statusCode).toBe(501);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("UNSUPPORTED_OPERATION");
    });
  });

  // ═══ Member Balance ═══

  describe("GET /members/:id/coalition/balance", () => {
    it("returns 200 with external balance", async () => {
      mockGetCachedExternalBalance.mockImplementation(
        async (_programId: string, _ref: string, fetchFresh: () => Promise<number>) => fetchFresh(),
      );
      mockCoalitionService.getExternalBalance.mockResolvedValue(1500);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/members/member-1/coalition/balance",
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: { memberId: string; balance: number } }>();
      expect(body.data.balance).toBe(1500);
    });
  });

  // ═══ Admin: Capabilities ═══

  describe("GET /admin/coalition/capabilities", () => {
    it("returns adapter capabilities", async () => {
      mockCoalitionService.getAdapterCapabilities.mockResolvedValue({
        accumulate: true,
        redeem: false,
        convert: true,
        reverseTransaction: false,
        historyQuery: true,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/coalition/capabilities",
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        data: { redeem: boolean; reverseTransaction: boolean };
      }>();
      expect(body.data.redeem).toBe(false);
      expect(body.data.reverseTransaction).toBe(false);
    });
  });

  // ═══ Admin: Link ═══

  describe("POST /admin/coalition/link", () => {
    it("returns 201 when account is linked", async () => {
      mockCoalitionService.linkExternalAccount.mockResolvedValue({
        id: "acc-1",
        memberId: "member-1",
        programId: "prog-1",
        provider: "APPRECIO",
        externalId: "user@test.com",
        externalBalance: 0,
        lastSyncedAt: new Date(),
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/coalition/link",
        headers: authHeaders,
        payload: {
          memberId: "member-1",
          externalMemberRef: "user@test.com",
        },
      });

      expect(res.statusCode).toBe(201);
    });
  });
});

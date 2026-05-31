import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ──────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  giftCardBatch: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  giftCard: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  giftCardTransaction: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  pointRule: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockGiftCardService = vi.hoisted(() => ({
  createBatch: vi.fn(),
  getBatch: vi.fn(),
  listBatches: vi.fn(),
  cancelBatch: vi.fn(),
  validateCode: vi.fn(),
  redeem: vi.fn(),
  refund: vi.fn(),
  cancelCard: vi.fn(),
  getTransactions: vi.fn(),
  createTermsTemplate: vi.fn(),
  listTermsTemplates: vi.fn(),
  getTermsTemplate: vi.fn(),
  updateTermsTemplate: vi.fn(),
  deleteTermsTemplate: vi.fn(),
  generateBatchCodes: vi.fn(),
  processExpiredCards: vi.fn(),
  getMetrics: vi.fn(),
  getOutstandingBalances: vi.fn(),
  setEnqueueGenerate: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../lib/giftcard-setup.js", () => ({
  giftCardService: mockGiftCardService,
}));

// ── Build app ──────────────────────────────────────

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";

let app: FastifyInstance;

const adminHeaders = {
  "x-api-key": "test-api-key",
  "x-program-id": "prog-1",
};

beforeEach(async () => {
  vi.clearAllMocks();

  mockPrisma.apiKey.findUnique.mockResolvedValue({
    id: "key-1",
    programId: "prog-1",
    key: "test-api-key",
    scope: "SERVER",
    isActive: true,
    name: "Test Key",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockPrisma.apiKey.update.mockResolvedValue({});
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((fn: never) => fn(mockPrisma));

  app = await buildApp({ logger: false });

  // Auth posture override — must be preHandler to run AFTER the auth plugin,
  // which also uses preHandler and would otherwise overwrite onRequest values.
  app.addHook("preHandler", async (request) => {
    const scope = (request.headers["x-api-scope"] as string) || "SERVER";
    const adminId = request.headers["x-admin-id"] as string | null;

    request.programId = (request.headers["x-program-id"] as string) || "prog-1";
    request.apiKeyScope = scope;
    request.adminId = adminId || (scope === "SERVER" ? "admin-1" : null);
  });
});

// ── Helpers ────────────────────────────────────────

const adminBase = "/api/v1/admin/giftcards";

// ── Authorization tests ────────────────────────────

describe("Authorization (Section A)", () => {
  it("a) member-scope cannot create batches", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/batches`,
      headers: {
        ...adminHeaders,
        "x-api-scope": "MEMBER",
        "x-admin-id": "",
      },
      payload: {
        name: "Test Batch",
        quantity: 10,
        initialAmount: 500,
        currency: "MXN",
        expirationDate: "2026-12-31",
        termsTemplateId: "terms-1",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("b) member-scope cannot refund", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/refund`,
      headers: {
        ...adminHeaders,
        "x-api-scope": "MEMBER",
        "x-admin-id": "",
        "idempotency-key": "idem-test",
      },
      payload: {
        code: "ABCDEFGHJKLMNPQR",
        amount: 100,
        reason: "customer request",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

// ── Cross-tenant guard ─────────────────────────────

describe("Cross-tenant guard (Section A.3)", () => {
  it("c) refund for card in different program returns 404", async () => {
    // Mock the service to throw GiftCardNotFoundError (simulating cross-tenant rejection)
    const { GiftCardNotFoundError } = await import("@loyaltyos/giftcards");
    mockGiftCardService.refund.mockRejectedValue(new GiftCardNotFoundError("ABCDEFGHJKLMNPQR"));

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/refund`,
      headers: {
        ...adminHeaders,
        "x-program-id": "prog-A",
        "idempotency-key": "idem-cross",
      },
      payload: {
        code: "ABCDEFGHJKLMNPQR",
        amount: 100,
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("GIFT_CARD_NOT_FOUND");
    // Verify refund was attempted (preHandler passed, route handler ran)
    expect(mockGiftCardService.refund).toHaveBeenCalled();
  });
});

// ── Export endpoint ────────────────────────────────

describe("Batch export (Section I.1)", () => {
  it("d) exports CSV with correct headers and data", async () => {
    mockGiftCardService.getBatch.mockResolvedValue({
      id: "batch-exp",
      programId: "prog-1",
      status: "ready",
    });

    mockPrisma.giftCard.findMany.mockResolvedValue([
      {
        code: "AAAA111122223333",
        initialAmount: { toNumber: () => 500 },
        currency: "MXN",
        expirationDate: new Date("2026-12-31"),
        status: "active",
      },
      {
        code: "BBBB444455556666",
        initialAmount: { toNumber: () => 1000 },
        currency: "MXN",
        expirationDate: new Date("2026-06-15"),
        status: "active",
      },
      {
        code: "CCCC777788889999",
        initialAmount: { toNumber: () => 250 },
        currency: "USD",
        expirationDate: new Date("2025-12-31"),
        status: "depleted",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/batches/batch-exp/export?format=csv`,
      headers: adminHeaders,
    });

    expect(res.statusCode).toBe(200);

    // reply.hijack() used for streaming; headers may not surface in inject mode
    const lines = res.body.split("\n").filter((l: string) => l.length > 0);
    expect(lines.length).toBe(4); // header + 3 rows
    const header = lines[0];
    expect(header).toContain("code");
    expect(header).toContain("initialAmount");
    expect(header).toContain("currency");
    expect(header).toContain("expirationDate");
    expect(header).toContain("status");
  });

  it("e) exports XLSX as valid spreadsheet", async () => {
    mockGiftCardService.getBatch.mockResolvedValue({
      id: "batch-xlsx",
      programId: "prog-1",
      status: "ready",
    });

    mockPrisma.giftCard.findMany.mockResolvedValue([
      {
        code: "AAAA111122223333",
        initialAmount: { toNumber: () => 500 },
        currency: "MXN",
        expirationDate: new Date("2026-12-31"),
        status: "active",
      },
      {
        code: "BBBB444455556666",
        initialAmount: { toNumber: () => 1000 },
        currency: "MXN",
        expirationDate: new Date("2026-06-15"),
        status: "active",
      },
      {
        code: "CCCC777788889999",
        initialAmount: { toNumber: () => 250 },
        currency: "USD",
        expirationDate: new Date("2025-12-31"),
        status: "depleted",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/batches/batch-xlsx/export?format=xlsx`,
      headers: adminHeaders,
    });

    expect(res.statusCode).toBe(200);

    // Parse the XLSX buffer (reply.hijack() streaming; headers may not surface in inject mode)
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.rawPayload);

    const worksheet = workbook.getWorksheet("Cards");
    expect(worksheet).toBeDefined();
    expect(worksheet!.actualRowCount).toBe(4); // header + 3 rows

    // Verify header row
    const headerRow = worksheet!.getRow(1);
    expect(headerRow.getCell(1).text).toBe("code");
    expect(headerRow.getCell(2).text).toBe("initialAmount");
    expect(headerRow.getCell(3).text).toBe("currency");
    expect(headerRow.getCell(4).text).toBe("expirationDate");
    expect(headerRow.getCell(5).text).toBe("status");
  });
});

// ── Cancel batch guard ─────────────────────────────

describe("Cancel batch guard (Section I.2)", () => {
  it("f) cancel batch with redeemed cards returns 409", async () => {
    const { BatchNotCancellableError } = await import("@loyaltyos/giftcards");
    mockGiftCardService.cancelBatch.mockRejectedValue(new BatchNotCancellableError("batch-1", 5));

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/batches/batch-1/cancel`,
      headers: adminHeaders,
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("BATCH_NOT_CANCELLABLE");
    expect(body.error.details.redeemedCount).toBe(5);
  });
});

// ── MCP schema validation ──────────────────────────

describe("MCP redeem schema (Section A.4)", () => {
  it("g) rejects missing idempotencyKey", async () => {
    const { GiftCardRedeemSchema } = await import("../../../mcp-server/src/tools/giftcards.js");

    const result = GiftCardRedeemSchema.safeParse({
      code: "ABCDEFGHJKLMNPQR",
      amount: 100,
      programSecret: "test-secret",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join("."));
      expect(issues).toContain("idempotencyKey");
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  coupon: {
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  couponRedemption: {
    create: vi.fn(),
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

vi.mock("../db.js", () => ({
  prisma: mockPrisma,
}));

// Default mocks that persist across tests
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
mockPrisma.pointRule.findMany.mockResolvedValue([]);
mockPrisma.$transaction.mockImplementation((fn: never) => fn(mockPrisma));

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";

let app: FastifyInstance;

const authHeaders = {
  "x-api-key": "test-api-key",
  "x-program-id": "prog-1",
};

beforeEach(async () => {
  vi.clearAllMocks();
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
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((fn: never) => fn(mockPrisma));
  app = await buildApp({ logger: false });

  app.addHook("onRequest", async (request) => {
    request.programId = (request.headers["x-program-id"] as string) || "prog-1";
    request.apiKeyScope = (request.headers["x-api-scope"] as string) || "admin";
  });
});

function couponRow(overrides = {}) {
  return {
    id: "coup-1",
    programId: "prog-1",
    code: "SUMMER20",
    mode: "SHARED" as const,
    discountType: "PERCENTAGE" as const,
    discountValue: 20,
    minPurchase: null,
    maxUses: null,
    maxUsesPerMember: null,
    usedCount: 0,
    isStackable: false,
    channels: [],
    startsAt: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    redemptions: [],
    ...overrides,
  };
}

const adminBase = "/api/v1/admin/coupons";

// ── Admin routes ──────────────────────────────────────────

describe("POST /admin/coupons", () => {
  it("creates a coupon and returns 201", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);
    mockPrisma.coupon.create.mockResolvedValue(couponRow());

    const res = await app.inject({
      method: "POST",
      url: adminBase,
      headers: authHeaders,
      payload: {
        code: "SUMMER20",
        mode: "SHARED",
        discountType: "PERCENTAGE",
        discountValue: 20,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.code).toBe("SUMMER20");
  });

  it("returns 400 when code is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: adminBase,
      headers: authHeaders,
      payload: { mode: "SHARED", discountType: "PERCENTAGE" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 on duplicate code", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());

    const res = await app.inject({
      method: "POST",
      url: adminBase,
      headers: authHeaders,
      payload: {
        code: "SUMMER20",
        mode: "SHARED",
        discountType: "PERCENTAGE",
        discountValue: 20,
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("COUPON_CODE_DUPLICATE");
  });
});

describe("POST /admin/coupons/generate", () => {
  it("generates bulk codes", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);
    mockPrisma.coupon.createMany.mockResolvedValue({ count: 5 });

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/generate`,
      headers: authHeaders,
      payload: {
        count: 5,
        discountType: "PERCENTAGE",
        discountValue: 15,
        prefix: "HOT",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(5);
    expect(body.data.every((c: string) => c.startsWith("HOT"))).toBe(true);
  });
});

describe("GET /admin/coupons", () => {
  it("lists coupons with pagination", async () => {
    mockPrisma.coupon.findMany.mockResolvedValue([couponRow()]);
    mockPrisma.coupon.count.mockResolvedValue(1);

    const res = await app.inject({
      method: "GET",
      url: adminBase,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.total).toBe(1);
  });

  it("filters by isActive", async () => {
    mockPrisma.coupon.findMany.mockResolvedValue([]);
    mockPrisma.coupon.count.mockResolvedValue(0);

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}?isActive=false`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("GET /admin/coupons/:id", () => {
  it("returns a coupon by id", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/coup-1`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe("coup-1");
  });

  it("returns 404 when not found", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/nonexistent`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("COUPON_NOT_FOUND");
  });
});

describe("PATCH /admin/coupons/:id", () => {
  it("updates a coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.coupon.update.mockResolvedValue(couponRow({ discountValue: 30 }));

    const res = await app.inject({
      method: "PATCH",
      url: `${adminBase}/coup-1`,
      headers: authHeaders,
      payload: { discountValue: 30 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.discountValue).toBe(30);
  });
});

describe("DELETE /admin/coupons/:id", () => {
  it("soft-deletes a coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());

    const res = await app.inject({
      method: "DELETE",
      url: `${adminBase}/coup-1`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(204);
  });
});

describe("GET /admin/coupons/:id/stats", () => {
  it("returns usage statistics", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ maxUses: 100, usedCount: 42 }));

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/coup-1/stats`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.usedCount).toBe(42);
    expect(body.data.remaining).toBe(58);
  });
});

// ── Public routes ─────────────────────────────────────────

describe("POST /coupons/validate", () => {
  it("returns valid for an active coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.couponRedemption.count.mockResolvedValue(0);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coupons/validate",
      headers: authHeaders,
      payload: { code: "SUMMER20", memberId: "mem-1", purchaseAmount: 50000 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.valid).toBe(true);
    expect(body.data.discountAmount).toBe(10000);
  });

  it("returns valid:false for missing coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coupons/validate",
      headers: authHeaders,
      payload: { code: "BOGUS", memberId: "mem-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.valid).toBe(false);
    expect(body.data.reason).toBe("Coupon not found");
  });

  it("returns 422 for expired coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ expiresAt: new Date("2020-01-01") }));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coupons/validate",
      headers: authHeaders,
      payload: { code: "SUMMER20", memberId: "mem-1" },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("COUPON_EXPIRED");
  });
});

describe("POST /coupons/redeem", () => {
  it("redeems a valid coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.couponRedemption.count.mockResolvedValue(0);
    mockPrisma.couponRedemption.create.mockResolvedValue({ id: "red-1" });
    mockPrisma.coupon.update.mockResolvedValue(couponRow());

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coupons/redeem",
      headers: authHeaders,
      payload: { code: "SUMMER20", memberId: "mem-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.redemptionId).toBe("red-1");
  });

  it("returns 422 for exhausted coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ maxUses: 100, usedCount: 100 }));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coupons/redeem",
      headers: authHeaders,
      payload: { code: "SUMMER20", memberId: "mem-1" },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("COUPON_EXHAUSTED");
  });
});

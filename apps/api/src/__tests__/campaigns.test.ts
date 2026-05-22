import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  campaign: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  campaignApplication: {
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  member: {
    count: vi.fn(),
    update: vi.fn(),
  },
  event: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  pointAccount: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  pointTransaction: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  pointRule: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: mockPrisma,
}));

// Default mocks that persist across tests (vi.clearAllMocks does not reset implementations)
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
mockPrisma.member.update.mockResolvedValue({});
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

  // Add onRequest hook at root level to set programId for tests
  // (auth plugin hooks are encapsulated, so we add a root-level hook)
  app.addHook("onRequest", async (request) => {
    request.programId = (request.headers["x-program-id"] as string) || "prog-1";
    request.apiKeyScope = (request.headers["x-api-scope"] as string) || "admin";
  });
});

function campaignRow(overrides = {}) {
  return {
    id: "camp-1",
    programId: "prog-1",
    name: "Test Campaign",
    description: null,
    type: "BONUS_POINTS" as const,
    conditions: null,
    multiplier: 2,
    maxBudget: 10000,
    maxUsesPerMember: 5,
    isStackable: false,
    isActive: true,
    abTesting: false,
    startsAt: null,
    endsAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [],
    applications: [],
    ...overrides,
  };
}

const adminBase = "/api/v1/admin/campaigns";

describe("POST /admin/campaigns", () => {
  it("creates a campaign and returns 201", async () => {
    mockPrisma.campaign.create.mockResolvedValue(campaignRow());

    const res = await app.inject({
      method: "POST",
      url: adminBase,
      headers: authHeaders,
      payload: { name: "Double Points", type: "BONUS_POINTS", multiplier: 2 },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe("Test Campaign");
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: adminBase,
      headers: authHeaders,
      payload: { type: "BONUS_POINTS" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates campaign with A/B variants", async () => {
    mockPrisma.campaign.create.mockResolvedValue(
      campaignRow({
        abTesting: true,
        variants: [
          {
            id: "v1",
            campaignId: "camp-1",
            name: "A",
            trafficPct: 50,
            config: null,
            createdAt: new Date(),
          },
          {
            id: "v2",
            campaignId: "camp-1",
            name: "B",
            trafficPct: 50,
            config: null,
            createdAt: new Date(),
          },
        ],
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: adminBase,
      headers: authHeaders,
      payload: {
        name: "AB Test",
        type: "BONUS_POINTS",
        abTesting: true,
        variants: [
          { name: "A", trafficPct: 50 },
          { name: "B", trafficPct: 50 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
  });
});

describe("GET /admin/campaigns", () => {
  it("lists campaigns with pagination", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue([campaignRow()]);
    mockPrisma.campaign.count.mockResolvedValue(1);

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
    mockPrisma.campaign.findMany.mockResolvedValue([]);
    mockPrisma.campaign.count.mockResolvedValue(0);

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}?isActive=false`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: false }),
      }),
    );
  });
});

describe("GET /admin/campaigns/:id", () => {
  it("returns a campaign by id", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow());

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/camp-1`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe("camp-1");
  });

  it("returns 404 when not found", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `${adminBase}/nonexistent`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /admin/campaigns/:id", () => {
  it("updates a campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow());
    mockPrisma.campaign.update.mockResolvedValue(campaignRow({ name: "Updated" }));

    const res = await app.inject({
      method: "PATCH",
      url: `${adminBase}/camp-1`,
      headers: authHeaders,
      payload: { name: "Updated" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe("Updated");
  });
});

describe("DELETE /admin/campaigns/:id", () => {
  it("soft-deletes a campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow());

    const res = await app.inject({
      method: "DELETE",
      url: `${adminBase}/camp-1`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(204);
  });
});

describe("POST /admin/campaigns/:id/estimate", () => {
  it("returns impact estimate", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow());
    mockPrisma.member.count.mockResolvedValue(50);

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/camp-1/estimate`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.estimatedMembers).toBe(50);
  });

  it("returns 404 for non-existent campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/nonexistent/estimate`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /admin/campaigns/:id/lifecycle", () => {
  it("activates a paused campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow({ isActive: false }));
    mockPrisma.campaign.update.mockResolvedValue(campaignRow({ isActive: true }));

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/camp-1/lifecycle`,
      headers: authHeaders,
      payload: { action: "activate" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.action).toBe("activate");
  });

  it("pauses an active campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow({ isActive: true }));
    mockPrisma.campaign.update.mockResolvedValue(campaignRow({ isActive: false }));

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/camp-1/lifecycle`,
      headers: authHeaders,
      payload: { action: "pause" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("archives a campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow());

    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/camp-1/lifecycle`,
      headers: authHeaders,
      payload: { action: "archive" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for invalid action", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${adminBase}/camp-1/lifecycle`,
      headers: authHeaders,
      payload: { action: "destroy" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /events with campaign integration", () => {
  it("evaluates and applies campaigns on purchase events", async () => {
    const eventId = "evt-1";
    mockPrisma.event.findUnique.mockResolvedValue(null);
    mockPrisma.event.create.mockResolvedValue({
      id: eventId,
      programId: "prog-1",
      type: "purchase",
      memberId: "mem-1",
      payload: { amount: 100 },
      idempotencyKey: "idem-1",
      processed: false,
      error: null,
      processedAt: null,
      createdAt: new Date(),
    });
    mockPrisma.event.update.mockResolvedValue({});

    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 500,
      pendingBalance: 0,
    });
    mockPrisma.pointAccount.create.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 0,
      pendingBalance: 0,
    });
    mockPrisma.pointAccount.update.mockResolvedValue({});
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-1",
      amount: 100,
      balanceAfter: 600,
    });
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);

    mockPrisma.campaign.findMany.mockResolvedValue([campaignRow()]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);
    mockPrisma.campaign.findFirst.mockResolvedValue(campaignRow());
    mockPrisma.campaignApplication.create.mockResolvedValue({ id: "app-1" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: {
        "idempotency-key": "idem-1",
        "x-api-key": "test-api-key",
        "x-program-id": "prog-1",
      },
      payload: {
        type: "purchase",
        memberId: "mem-1",
        payload: { amount: 100, category: "electronics" },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.appliedCampaigns).toBeDefined();
  });

  it("returns idempotent response for duplicate event", async () => {
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "evt-existing",
      programId: "prog-1",
      type: "purchase",
      memberId: "mem-1",
      payload: { amount: 100 },
      idempotencyKey: "idem-dup",
      processed: true,
      error: null,
      processedAt: new Date(),
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: {
        "idempotency-key": "idem-dup",
        "x-api-key": "test-api-key",
        "x-program-id": "prog-1",
      },
      payload: { type: "purchase", memberId: "mem-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.idempotent).toBe(true);
  });

  it("requires idempotency-key header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-api-key": "test-api-key", "x-program-id": "prog-1" },
      payload: { type: "purchase" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("MISSING_HEADER");
  });

  it("handles registration events with signup bonus", async () => {
    mockPrisma.event.findUnique.mockResolvedValue(null);
    mockPrisma.event.create.mockResolvedValue({
      id: "evt-reg",
      programId: "prog-1",
      type: "registration",
      memberId: "mem-1",
      payload: null,
      idempotencyKey: "idem-reg",
      processed: false,
      error: null,
      processedAt: null,
      createdAt: new Date(),
    });
    mockPrisma.event.update.mockResolvedValue({});

    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 0,
      pendingBalance: 0,
    });
    mockPrisma.pointAccount.create.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 0,
      pendingBalance: 0,
    });
    mockPrisma.pointAccount.update.mockResolvedValue({});
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-reg",
      amount: 500,
      balanceAfter: 500,
    });
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: {
        "idempotency-key": "idem-reg",
        "x-api-key": "test-api-key",
        "x-program-id": "prog-1",
      },
      payload: { type: "registration", memberId: "mem-1" },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.earnResult.amount).toBe(500);
  });
});

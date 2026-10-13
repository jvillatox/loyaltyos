import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock notifications service
vi.mock("../lib/notifications-setup.js", () => ({
  notificationsService: {
    sendTrigger: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockPrisma = vi.hoisted(() => ({
  member: {
    name: "Member",
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  magicLinkToken: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  pointRule: {
    findMany: vi.fn(),
  },
}));

vi.mock("../db.js", () => ({
  prisma: mockPrisma,
}));

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";

let app: FastifyInstance;

const originalNodeEnv = process.env.NODE_ENV;
const originalMetricsToken = process.env.METRICS_TOKEN;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  mockPrisma.apiKey.findUnique.mockResolvedValue({
    id: "key-1",
    programId: "prog_dev",
    key: "test-key",
    scope: "SERVER",
    isActive: true,
    name: "Test Key",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockPrisma.apiKey.update.mockResolvedValue({});
  app = await buildApp({ logger: false });
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalMetricsToken === undefined) {
    delete process.env.METRICS_TOKEN;
  } else {
    process.env.METRICS_TOKEN = originalMetricsToken;
  }
});

describe("health endpoints", () => {
  it("GET /healthz is public (200 without auth)", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("GET /healthz with a query string is still public", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz?verbose=1" });
    expect(res.statusCode).toBe(200);
  });

  it("does not treat unknown /healthz-* paths as public", async () => {
    // A path sharing the /healthz prefix must NOT bypass auth. It is rejected
    // with 401 (not served as public); with a prefix match it would have been
    // whitelisted and hit the router instead.
    const res = await app.inject({ method: "GET", url: "/healthz-secret" });
    expect(res.statusCode).toBe(401);
  });
});

describe("metrics endpoint", () => {
  it("is open in non-production when METRICS_TOKEN is unset", async () => {
    delete process.env.METRICS_TOKEN;
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveLength(0);
  });

  it("returns 401 without a token when METRICS_TOKEN is set", async () => {
    process.env.METRICS_TOKEN = "secret-metrics-token";
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with an incorrect token", async () => {
    process.env.METRICS_TOKEN = "secret-metrics-token";
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with the correct bearer token", async () => {
    process.env.METRICS_TOKEN = "secret-metrics-token";
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer secret-metrics-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveLength(0);
  });

  it("returns 404 in production when METRICS_TOKEN is unset", async () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "production";
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(404);
  });
});

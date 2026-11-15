import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/notifications-setup.js", () => ({
  notificationsService: {
    sendTrigger: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockPrisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn(), findUnique: vi.fn() },
  magicLinkToken: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  apiKey: { findUnique: vi.fn(), update: vi.fn() },
  pointRule: { findMany: vi.fn() },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";

let app: FastifyInstance;

function preflight(origin: string) {
  return app.inject({
    method: "OPTIONS",
    url: "/healthz",
    headers: {
      origin,
      "access-control-request-method": "GET",
    },
  });
}

beforeEach(() => {
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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CORS allowlist", () => {
  it("reflects a listed origin on preflight", async () => {
    vi.stubEnv("CORS_ORIGINS", "https://shop.example.com");
    app = await buildApp({ logger: false });

    const res = await preflight("https://shop.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://shop.example.com");
  });

  it("does not allow an origin that is not listed", async () => {
    vi.stubEnv("CORS_ORIGINS", "https://shop.example.com");
    app = await buildApp({ logger: false });

    const res = await preflight("https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ignores the wildcard in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "*");
    app = await buildApp({ logger: false });

    const res = await preflight("https://shop.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

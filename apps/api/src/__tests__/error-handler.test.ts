import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  member: {
    name: "Member",
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
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

// Mock notifications service
vi.mock("../lib/notifications-setup.js", () => ({
  notificationsService: {
    sendTrigger: vi.fn().mockResolvedValue(undefined),
  },
}));

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";
import { LoyaltyError } from "../lib/errors.js";
import { localizeMessage } from "../lib/error-handler.js";

let app: FastifyInstance;

function mockApiKeyValid() {
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
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockApiKeyValid();
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  app = await buildApp({ logger: false });
});

describe("localizeMessage — prototype-safe lookup", () => {
  it("returns the literal '__proto__' instead of traversing prototype", () => {
    expect(localizeMessage("__proto__", "es-MX")).toBe("__proto__");
  });

  it("returns the literal 'constructor' instead of traversing prototype", () => {
    expect(localizeMessage("constructor", "es-MX")).toBe("constructor");
  });

  it("still resolves real error codes", () => {
    const result = localizeMessage("INSUFFICIENT_BALANCE", "es-MX");
    expect(result).not.toBe("INSUFFICIENT_BALANCE");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the code for unknown error codes", () => {
    expect(localizeMessage("UNKNOWN_CODE_XYZ", "es-MX")).toBe("UNKNOWN_CODE_XYZ");
  });
});

describe("error envelope — no details leak", () => {
  it("LoyaltyError response has no details field", async () => {
    // Hit a magic-link verify endpoint with an invalid token, which throws LoyaltyError
    mockPrisma.magicLinkToken.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "bad-token" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toHaveProperty("code");
    expect(body.error).toHaveProperty("message");
    expect(body.error).not.toHaveProperty("details");
  });
});

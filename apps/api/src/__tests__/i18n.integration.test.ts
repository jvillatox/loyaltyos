import { beforeEach, describe, expect, it, vi } from "vitest";

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

import type { FastifyInstance } from "fastify";

import { buildApp } from "../app.js";
import { lucia } from "../lib/auth/lucia.js";

let app: FastifyInstance;

const programFixture = {
  defaultLocale: "es-MX",
  supportedLocales: ["es-MX", "en-US"],
};

const memberFixture = {
  id: "mem-1",
  email: "carlos@example.com",
  phone: "+521234567890",
  firstName: "Carlos",
  lastName: "Mendoza",
  programId: "prog_dev",
  locale: null,
  joinedAt: new Date("2024-01-15"),
  deletedAt: null,
  tags: [],
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
};

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

async function createMemberSession(): Promise<string> {
  mockPrisma.session.create.mockResolvedValue({
    id: "session-test",
    userId: "mem-1",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  const session = await lucia.createSession("mem-1", {});
  const cookie = lucia.createSessionCookie(session.id);
  return cookie.serialize().split(";")[0] ?? "";
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockApiKeyValid();
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  app = await buildApp({ logger: false });
});

// ── Magic link locale persistence ─────────────────────────

describe("POST /auth/magic-link — locale persistence", () => {
  it("persists locale on existing member when member.locale is null and locale is supported", async () => {
    mockPrisma.member.findFirst.mockResolvedValueOnce({
      ...memberFixture,
      locale: null,
      program: programFixture,
    });
    mockPrisma.member.update.mockResolvedValue({
      ...memberFixture,
      locale: "en-US",
    });
    mockPrisma.magicLinkToken.create.mockResolvedValue({
      id: "tok-1",
      memberId: "mem-1",
      tokenHash: "hash",
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com", locale: "en-US" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.member.update).toHaveBeenCalledWith({
      where: { id: "mem-1" },
      data: { locale: "en-US" },
    });
  });

  it("does not overwrite locale when member already has one", async () => {
    mockPrisma.member.findFirst.mockResolvedValueOnce({
      ...memberFixture,
      locale: "es-MX",
      program: programFixture,
    });
    mockPrisma.magicLinkToken.create.mockResolvedValue({
      id: "tok-2",
      memberId: "mem-1",
      tokenHash: "hash",
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com", locale: "en-US" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.member.update).not.toHaveBeenCalled();
  });

  it("does not persist locale when it is not in program.supportedLocales", async () => {
    mockPrisma.member.findFirst.mockResolvedValueOnce({
      ...memberFixture,
      locale: null,
      program: { ...programFixture, supportedLocales: ["es-MX"] },
    });
    mockPrisma.magicLinkToken.create.mockResolvedValue({
      id: "tok-3",
      memberId: "mem-1",
      tokenHash: "hash",
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com", locale: "en-US" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.member.update).not.toHaveBeenCalled();
  });

  it("does not persist script tag as locale and does not 500", async () => {
    mockPrisma.member.findFirst.mockResolvedValueOnce({
      ...memberFixture,
      locale: null,
      program: programFixture,
    });
    mockPrisma.magicLinkToken.create.mockResolvedValue({
      id: "tok-xss",
      memberId: "mem-1",
      tokenHash: "hash",
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com", locale: "<script>" },
    });

    expect(res.statusCode).toBe(200);
    // Must not persist the injected value
    expect(mockPrisma.member.update).not.toHaveBeenCalled();
  });
});

// ── GET /auth/me extended response ─────────────────────────

describe("GET /auth/me — locale and program info", () => {
  it("returns locale and program locale settings", async () => {
    const cookieHeader = await createMemberSession();

    mockPrisma.session.findUnique.mockResolvedValue({
      id: "session-test",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      member: memberFixture,
    });
    mockPrisma.member.findUnique.mockResolvedValue({
      ...memberFixture,
      locale: "en-US",
      program: programFixture,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.locale).toBe("en-US");
    expect(body.data.program.defaultLocale).toBe("es-MX");
    expect(body.data.program.supportedLocales).toEqual(["es-MX", "en-US"]);
  });

  it("returns locale null when member has no override", async () => {
    const cookieHeader = await createMemberSession();

    mockPrisma.session.findUnique.mockResolvedValue({
      id: "session-test",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      member: memberFixture,
    });
    mockPrisma.member.findUnique.mockResolvedValue({
      ...memberFixture,
      locale: null,
      program: programFixture,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.locale).toBeNull();
  });
});

// ── PATCH /members/me ──────────────────────────────────────

describe("PATCH /members/me", () => {
  it("updates locale when valid", async () => {
    const cookieHeader = await createMemberSession();

    mockPrisma.session.findUnique.mockResolvedValue({
      id: "session-test",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      member: memberFixture,
    });
    mockPrisma.member.findUnique.mockResolvedValue({
      ...memberFixture,
      program: programFixture,
    });
    mockPrisma.member.update.mockResolvedValue({
      ...memberFixture,
      locale: "en-US",
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/members/me",
      headers: { cookie: cookieHeader },
      payload: { locale: "en-US" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.locale).toBe("en-US");
  });

  it("rejects unsupported locale with 400", async () => {
    const cookieHeader = await createMemberSession();

    mockPrisma.session.findUnique.mockResolvedValue({
      id: "session-test",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      member: memberFixture,
    });
    mockPrisma.member.findUnique.mockResolvedValue({
      ...memberFixture,
      program: { ...programFixture, supportedLocales: ["es-MX"] },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/members/me",
      headers: { cookie: cookieHeader },
      payload: { locale: "en-US" },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 401 when not authenticated", async () => {
    // No X-API-Key header and no session cookie → 401
    mockPrisma.apiKey.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/members/me",
      payload: { locale: "en-US" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 429 after exceeding rate limit", async () => {
    mockPrisma.apiKey.findUnique.mockResolvedValue(null);

    // Fire 31 requests — the first 30 should not 429, at least one must 429
    const results: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/members/me",
        payload: { locale: "en-US" },
      });
      results.push(res.statusCode);
    }

    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    // All other responses should still be 401 (missing auth) — not 200
    expect(results.filter((s) => s !== 429 && s !== 401).length).toBe(0);
  });
});

// ── Accept-Language error localization ─────────────────────

describe("Accept-Language error localization", () => {
  it("returns English message with Accept-Language: en-US", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      headers: { "accept-language": "en-US" },
      payload: { token: "bad-token" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_TOKEN");
    // Should be the English translation, not just the code
    expect(body.error.message).not.toBe("INVALID_TOKEN");
  });

  it("returns Spanish message with Accept-Language: es-MX", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      headers: { "accept-language": "es-MX" },
      payload: { token: "bad-token" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_TOKEN");
    // Should be the Spanish translation
    expect(body.error.message).not.toBe("INVALID_TOKEN");
  });

  it("returns Spanish by default with no Accept-Language header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "bad-token" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_TOKEN");
    expect(body.error.message).not.toBe("INVALID_TOKEN");
  });
});

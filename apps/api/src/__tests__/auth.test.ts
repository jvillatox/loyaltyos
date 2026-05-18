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

function cookieValue(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? (setCookie[0] ?? "") : (setCookie ?? "");
  return raw.split(";")[0] ?? "";
}

const memberFixture = {
  id: "mem-1",
  email: "carlos@example.com",
  phone: "+521234567890",
  firstName: "Carlos",
  lastName: "Mendoza",
  programId: "prog_dev",
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

const memberWithTiers = {
  ...memberFixture,
  pointAccount: null,
  memberTiers: [],
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockApiKeyValid();
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  // Default: notification's findFirst gets a safe fallback
  mockPrisma.member.findFirst.mockResolvedValue(memberWithTiers);
  app = await buildApp({ logger: false });
});

// ── POST /auth/magic-link ──────────────────────────────────

describe("POST /auth/magic-link", () => {
  it("returns 200 for a known email", async () => {
    mockPrisma.member.findFirst.mockResolvedValueOnce(memberFixture);
    mockPrisma.magicLinkToken.create.mockResolvedValue({
      id: "tok-1",
      memberId: "mem-1",
      tokenHash: expect.any(String) as unknown as string,
      expiresAt: new Date(),
      consumedAt: null,
      createdAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("returns 200 for an unknown email (prevents enumeration)", async () => {
    mockPrisma.member.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "nobody@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(mockPrisma.magicLinkToken.create).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "not-an-email" },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── POST /auth/verify-magic-link ───────────────────────────

describe("POST /auth/verify-magic-link", () => {
  it("returns 401 for an invalid token", async () => {
    mockPrisma.magicLinkToken.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "invalid-token" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns 401 for an expired token", async () => {
    mockPrisma.magicLinkToken.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "expired-token" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("verifies a valid token, sets session cookie, and returns member", async () => {
    const tokenRecord = {
      id: "tok-1",
      memberId: "mem-1",
      tokenHash: expect.any(String) as unknown as string,
      expiresAt: new Date(Date.now() + 60000),
      consumedAt: null,
      createdAt: new Date(),
      member: memberFixture,
    };
    mockPrisma.magicLinkToken.findFirst.mockResolvedValue(tokenRecord);
    mockPrisma.magicLinkToken.update.mockResolvedValue({
      ...tokenRecord,
      consumedAt: new Date(),
    });
    mockPrisma.session.create.mockResolvedValue({
      id: "session-1",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.member.id).toBe("mem-1");
    expect(body.data.member.email).toBe("carlos@example.com");
    expect(body.data.sessionId).toBeTruthy();

    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeTruthy();
    expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toContain("loyaltyos_session");
  });
});

// ── GET /auth/me ───────────────────────────────────────────

describe("GET /auth/me", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the authenticated member with a valid session cookie", async () => {
    // Create a real session cookie using lucia
    mockPrisma.session.create.mockResolvedValue({
      id: "session-me",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const session = await lucia.createSession("mem-1", {});
    const cookie = lucia.createSessionCookie(session.id);

    mockPrisma.session.findUnique.mockResolvedValue({
      id: session.id,
      userId: "mem-1",
      expiresAt: session.expiresAt,
      member: memberFixture,
    });
    mockPrisma.member.findUnique.mockResolvedValue(memberFixture);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: cookie.serialize().split(";")[0] ?? "" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe("mem-1");
    expect(body.data.email).toBe("carlos@example.com");
  });

  it("returns 401 with an invalid session cookie", async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: "loyaltyos_session=invalid-session-id" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── POST /auth/logout ──────────────────────────────────────

describe("POST /auth/logout", () => {
  it("clears the session cookie on logout", async () => {
    mockPrisma.session.create.mockResolvedValue({
      id: "session-out",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const session = await lucia.createSession("mem-1", {});
    const cookie = lucia.createSessionCookie(session.id);
    const cookieHeader = cookie.serialize().split(";")[0] ?? "";

    // Mock for lucia.readSessionCookie → lucia.validateSession → invalidateSession
    mockPrisma.session.findUnique.mockResolvedValue({
      id: session.id,
      userId: "mem-1",
      expiresAt: session.expiresAt,
      member: memberFixture,
    });
    mockPrisma.session.delete.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: cookieHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeTruthy();
    expect(Array.isArray(setCookie) ? setCookie.join(",") : setCookie).toContain(
      "loyaltyos_session",
    );
  });

  it("succeeds even without a cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

// ── Full flow ──────────────────────────────────────────────

describe("magic-link full flow", () => {
  it("magic-link → verify → me → logout", async () => {
    // 1. Request magic link
    mockPrisma.member.findFirst.mockResolvedValueOnce(memberFixture);
    mockPrisma.magicLinkToken.create.mockResolvedValue({
      id: "tok-flow",
      memberId: "mem-1",
      tokenHash: expect.any(String) as unknown as string,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const magicRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com" },
    });
    expect(magicRes.statusCode).toBe(200);

    // 2. Verify — simulate the token hash lookup
    mockPrisma.magicLinkToken.findFirst.mockResolvedValue({
      id: "tok-flow",
      memberId: "mem-1",
      tokenHash: expect.any(String) as unknown as string,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      consumedAt: null,
      createdAt: new Date(),
      member: memberFixture,
    });
    mockPrisma.magicLinkToken.update.mockResolvedValue({
      id: "tok-flow",
      consumedAt: new Date(),
    });
    mockPrisma.session.create.mockResolvedValue({
      id: "session-flow",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "any-token" },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(JSON.parse(verifyRes.body).data.member.id).toBe("mem-1");

    // Extract the session cookie from the response
    const sessionCookie = cookieValue(verifyRes.headers["set-cookie"]);

    // 3. GET /auth/me with the cookie
    // Mock session lookup for the session ID embedded in the cookie
    const sessionIdMatch = sessionCookie.match(/loyaltyos_session=([^;]+)/);
    const sessionId = sessionIdMatch?.[1] ?? "session-flow";
    mockPrisma.session.findUnique.mockResolvedValue({
      id: sessionId,
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      member: memberFixture,
    });
    mockPrisma.member.findUnique.mockResolvedValue(memberFixture);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sessionCookie },
    });
    expect(meRes.statusCode).toBe(200);
    expect(JSON.parse(meRes.body).data.email).toBe("carlos@example.com");

    // 4. POST /auth/logout
    mockPrisma.session.delete.mockResolvedValue(undefined);

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: sessionCookie },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(JSON.parse(logoutRes.body)).toEqual({ ok: true });
    expect(logoutRes.headers["set-cookie"]).toBeTruthy();
  });
});

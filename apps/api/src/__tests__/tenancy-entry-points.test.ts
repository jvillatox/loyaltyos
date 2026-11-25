import { invalidateOrganizationCache } from "@loyaltyos/tenancy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock notifications service (fire-and-forget magic-link email).
vi.mock("../lib/notifications-setup.js", () => ({
  notificationsService: {
    sendTrigger: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockPrisma = vi.hoisted(() => ({
  $queryRawUnsafe: vi.fn(),
  program: {
    findUnique: vi.fn(),
  },
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

const ORG = "org_1";
const PROGRAM = "prog_dev";

const memberFixture = {
  id: "mem-1",
  email: "carlos@example.com",
  phone: "+521234567890",
  firstName: "Carlos",
  lastName: "Mendoza",
  programId: PROGRAM,
  locale: null,
  joinedAt: new Date("2024-01-15"),
  deletedAt: null,
  tags: [],
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
  program: {
    defaultLocale: "es-MX",
    supportedLocales: ["es-MX", "en-US"],
  },
};

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  invalidateOrganizationCache();
  process.env.TENANCY_RLS = "enforce";

  // The SECURITY DEFINER resolver returns the org for the program, so the direct
  // Program read (the fallback) must never be reached.
  mockPrisma.$queryRawUnsafe.mockResolvedValue([{ organizationId: ORG }]);
  mockPrisma.program.findUnique.mockResolvedValue({ organizationId: ORG });
  mockPrisma.pointRule.findMany.mockResolvedValue([]);
  mockPrisma.member.findFirst.mockResolvedValue({
    ...memberFixture,
    pointAccount: null,
    memberTiers: [],
  });
  mockPrisma.member.findUnique.mockResolvedValue(memberFixture);
  mockPrisma.member.update.mockResolvedValue(memberFixture);

  app = await buildApp({ logger: false });
});

afterEach(() => {
  delete process.env.TENANCY_RLS;
});

describe("pre-context entry points (TENANCY_RLS=enforce)", () => {
  it("magic-link request resolves org via app_org_for_program and never reads Program", async () => {
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
      payload: { email: "carlos@example.com", programId: PROGRAM },
    });

    expect(res.statusCode).toBe(200);

    // Resolves the org through the SECURITY DEFINER function, never a direct
    // `Program` read (which would throw TenantContextMissing under enforce).
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("app_org_for_program"),
      PROGRAM,
    );
    expect(mockPrisma.program.findUnique).not.toHaveBeenCalled();

    // The member lookup is scoped to the requested program.
    expect(mockPrisma.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: "carlos@example.com", programId: PROGRAM }),
      }),
    );
  });

  it("magic-link request resolves the program from the X-Program-Id header", async () => {
    mockPrisma.magicLinkToken.create.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      headers: { "x-program-id": PROGRAM },
      payload: { email: "carlos@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("app_org_for_program"),
      PROGRAM,
    );
    expect(mockPrisma.program.findUnique).not.toHaveBeenCalled();
  });

  it("GET /auth/me resolves org from the session's program and never reads Program", async () => {
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

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: cookie.serialize().split(";")[0] ?? "" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("app_org_for_program"),
      PROGRAM,
    );
    expect(mockPrisma.program.findUnique).not.toHaveBeenCalled();
  });

  it("verify-magic-link and logout never read Program", async () => {
    // verify-magic-link reads the global MagicLinkToken (include member), not Program.
    mockPrisma.magicLinkToken.findFirst.mockResolvedValue({
      id: "tok-1",
      memberId: "mem-1",
      tokenHash: expect.any(String) as unknown as string,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
      member: memberFixture,
    });
    mockPrisma.magicLinkToken.update.mockResolvedValue({});
    mockPrisma.session.create.mockResolvedValue({
      id: "session-v",
      userId: "mem-1",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-magic-link",
      payload: { token: "valid-token" },
    });
    expect(verifyRes.statusCode).toBe(200);

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
    });
    expect(logoutRes.statusCode).toBe(200);

    expect(mockPrisma.program.findUnique).not.toHaveBeenCalled();
  });

  it("magic-link under enforce without a programId returns generic 200 and sends no link", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email: "carlos@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(mockPrisma.magicLinkToken.create).not.toHaveBeenCalled();
    // No program → no org resolution, no member lookup.
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(mockPrisma.member.findFirst).not.toHaveBeenCalled();
  });

  it("magic-link under enforce with a nonexistent program returns generic 200 and sends no link", async () => {
    // `app_org_for_program` finds nothing and the direct Program fallback fails,
    // so the resolver throws — the route must still answer generically.
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockPrisma.program.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      headers: { "x-program-id": "prog_nope" },
      payload: { email: "carlos@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(mockPrisma.magicLinkToken.create).not.toHaveBeenCalled();
  });
});

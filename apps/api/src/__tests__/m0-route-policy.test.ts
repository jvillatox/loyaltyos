import { createHash, randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import { ADMIN_ROLES } from "@loyaltyos/permissions";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { coalitionService } from "../lib/coalition-setup.js";
import { PRINCIPALS, routePolicy } from "../lib/route-policy.js";
import type { Principal } from "../lib/route-policy.js";

// M0 point 1 — deny-by-default route policy for non-/admin routes.
//
// The auth plugin resolves a principal (CLIENT / MEMBER / SERVER / admin role)
// but nothing enforces its scope on non-admin routes, so a CLIENT API key or a
// member session can call any endpoint. These tests encode the target policy:
//
//   anonymous            → 401 (auth plugin, already enforced)
//   CLIENT               → read-only rewards catalog (GET /rewards, GET /rewards/:id)
//   MEMBER               → self-only (/members/me*) + catalog + redeem self
//   SERVER               → everything
//   ANALYST              → read-only (GET only on non-admin routes)
//   OPERATOR / SUPER_ADMIN → everything
//
// Expected to fail today (red): `routePolicy` returns [] and no hook enforces it.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const programId = `prog_m0p_${suffix}`;
const serverKey = `sk_${suffix}`;
const clientKey = `ck_${suffix}`;

let memberId: string;
let otherMemberId: string;
let rewardId: string;
let memberCookie = "";

const adminCookies = {} as Record<AdminRole, string>;

// ── Reference policy (the point-1 spec this test asserts against) ──────────

const CATALOG: readonly Principal[] = [
  "CLIENT",
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];
const MEMBER_SELF: readonly Principal[] = [
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];
const READ: readonly Principal[] = ["SERVER", "ANALYST", "OPERATOR", "SUPER_ADMIN"];
const MUTATE: readonly Principal[] = ["SERVER", "OPERATOR", "SUPER_ADMIN"];
const REDEEM: readonly Principal[] = ["MEMBER", "SERVER", "OPERATOR", "SUPER_ADMIN"];

const MEMBER_SELF_RE = /^\/api\/v1\/members\/me(?:\/|$)/;

/** Principals (excluding anonymous) that the point-1 policy allows on `method url`. */
function allowedPrincipals(method: string, url: string): readonly Principal[] {
  const m = method.toUpperCase();
  if (MEMBER_SELF_RE.test(url)) return MEMBER_SELF;
  if (m === "GET" && (url === "/api/v1/rewards" || url === "/api/v1/rewards/:id")) {
    return CATALOG;
  }
  if (url === "/api/v1/rewards/:id/redeem") return REDEEM;
  if (m === "GET") return READ;
  return MUTATE;
}

const NON_ANONYMOUS = PRINCIPALS.filter((p) => p !== "anonymous");

// ── Route inventory (derived from the onRoute hook, not hand-written) ───────

const IN_SCOPE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function isInScope(entry: { method: string; url: string }): boolean {
  if (!IN_SCOPE_METHODS.has(entry.method.toUpperCase())) return false;
  if (!entry.url.startsWith("/api/v1/")) return false;
  if (entry.url.startsWith("/api/v1/admin/")) return false;
  if (entry.url.startsWith("/api/v1/auth/")) return false;
  return true;
}

// ── Setup ───────────────────────────────────────────────────────────────────

async function loginAs(role: AdminRole): Promise<string> {
  const email = `m0p-${role.toLowerCase()}-${suffix}@loyaltyos.dev`;
  const password = `pw-${suffix}`;
  await prisma.adminUser.create({
    data: {
      email,
      name: `M0P ${role}`,
      passwordHash: await hashPassword(password),
      role,
      programId,
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  return `${c?.name}=${c?.value}`;
}

async function memberSessionCookie(targetMemberId: string): Promise<string> {
  const rawToken = createHash("sha256").update(`m0p-${targetMemberId}`).digest("hex");
  await prisma.magicLinkToken.create({
    data: {
      memberId: targetMemberId,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  const verify = await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-magic-link",
    payload: { token: rawToken },
  });
  const c = verify.cookies.find((x) => x.name === "loyaltyos_session");
  return `${c?.name}=${c?.value}`;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programId, name: `M0P ${suffix}` } });

  await prisma.apiKey.create({ data: { programId, key: serverKey, scope: "SERVER" } });
  await prisma.apiKey.create({ data: { programId, key: clientKey, scope: "CLIENT" } });

  const member = await prisma.member.create({
    data: { email: `m0p-main-${suffix}@loyaltyos.dev`, programId },
  });
  memberId = member.id;
  const other = await prisma.member.create({
    data: { email: `m0p-other-${suffix}@loyaltyos.dev`, programId },
  });
  otherMemberId = other.id;

  memberCookie = await memberSessionCookie(memberId);

  const reward = await prisma.reward.create({
    data: { programId, name: `Reward ${suffix}`, pointsCost: 50 },
  });
  rewardId = reward.id;

  // Balance so a successful redeem is possible (attack-proof test).
  await prisma.pointAccount.create({
    data: { memberId, programId, balance: 100, totalEarned: 100 },
  });

  for (const role of ADMIN_ROLES) {
    adminCookies[role] = await loginAs(role);
  }

  // Mock coalition adapter so a CLIENT-key accumulate can actually succeed today.
  coalitionService.registerAdapter({
    name: "M0RP_ATTACK",
    capabilities: {
      accumulate: true,
      redeem: false,
      convert: false,
      reverseTransaction: false,
      historyQuery: false,
    },
    healthcheck: async () => ({ ok: true }),
    getBalance: async () => 0,
    accumulate: async () => ({ externalTxId: "ext-attack", balanceAfter: 110 }),
  });
  await prisma.coalitionConfig.create({
    data: {
      programId,
      provider: "M0RP_ATTACK",
      endpoint: "https://example.invalid",
      encryptedCredentials: "x",
      accumulationEnabled: true,
    },
  });
});

afterAll(async () => {
  await prisma.coalitionTransaction
    .deleteMany({ where: { account: { programId } } })
    .catch(() => {});
  await prisma.coalitionAccount.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.coalitionConfig.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.rewardRedemption
    .deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.pointTransaction
    .deleteMany({ where: { account: { memberId: { in: [memberId, otherMemberId] } } } })
    .catch(() => {});
  await prisma.pointAccount
    .deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.memberDevice.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.event.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.magicLinkToken
    .deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.session
    .deleteMany({ where: { userId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.reward.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { programId } }).catch(() => {});
  for (const role of ADMIN_ROLES) {
    const admin = await prisma.adminUser.findUnique({
      where: { email: `m0p-${role.toLowerCase()}-${suffix}@loyaltyos.dev` },
    });
    if (admin) {
      await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
      await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
    }
  }
  await prisma.program.delete({ where: { id: programId } }).catch(() => {});
  await app.close();
});

const serverHeaders = () => ({ "x-api-key": serverKey, "x-program-id": programId });
const clientHeaders = () => ({ "x-api-key": clientKey, "x-program-id": programId });

// ── Contract: every registered non-admin route has a policy ─────────────────

describe("M0 route policy — contract (derived from onRoute)", () => {
  it("every in-scope route has a non-empty policy", () => {
    const routes = app.routeCatalog.filter(isInScope);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(
        routePolicy(r.method, r.url),
        `${r.method} ${r.url} has no policy entry`,
      ).not.toHaveLength(0);
    }
  });

  it("route policy matches the point-1 matrix for every route × principal", () => {
    const routes = app.routeCatalog.filter(isInScope);
    let cases = 0;
    for (const r of routes) {
      const allowed = allowedPrincipals(r.method, r.url);
      const actual = routePolicy(r.method, r.url);
      for (const principal of NON_ANONYMOUS) {
        cases += 1;
        const shouldAllow = allowed.includes(principal);
        expect(
          actual.includes(principal),
          `${r.method} ${r.url} should ${shouldAllow ? "allow" : "deny"} ${principal}`,
        ).toBe(shouldAllow);
      }
    }
    expect(cases).toBe(routes.length * NON_ANONYMOUS.length);
  });
});

// ── Behavioral spot-checks ──────────────────────────────────────────────────

describe("M0 route policy — CLIENT scope is read-only (rewards catalog)", () => {
  it("GET /rewards → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/rewards",
      headers: clientHeaders(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /rewards/:id → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/rewards/${rewardId}`,
      headers: clientHeaders(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /events → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...clientHeaders(), "idempotency-key": `m0p-ev-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /members → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: clientHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /members/:id/adjust → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { ...clientHeaders(), "idempotency-key": `m0p-adj-${suffix}` },
      payload: { amount: 10, reason: "test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /rewards/:id/redeem → 403 (attack proof, was 201), balance unchanged", async () => {
    const before = await prisma.pointAccount.findUnique({ where: { memberId } });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/rewards/${rewardId}/redeem`,
      headers: clientHeaders(),
      payload: { rewardId, memberId, idempotencyKey: `m0p-rd-${suffix}` },
    });
    expect(res.statusCode).toBe(403);
    const after = await prisma.pointAccount.findUnique({ where: { memberId } });
    expect(after?.balance).toBe(before?.balance);
  });

  it("POST /coalition/accumulate → 403 (attack proof, was 201), no account created", async () => {
    const before = await prisma.coalitionAccount.count({ where: { memberId, programId } });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coalition/accumulate",
      headers: { ...clientHeaders(), "idempotency-key": `m0p-co-${suffix}` },
      payload: {
        memberId,
        externalMemberRef: "ext-attack",
        points: 10,
        txRef: `tx-attack-${suffix}`,
      },
    });
    expect(res.statusCode).toBe(403);
    const after = await prisma.coalitionAccount.count({ where: { memberId, programId } });
    expect(after).toBe(before);
  });
});

describe("M0 route policy — MEMBER scope is self-only", () => {
  it("GET /members/me → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /members/me/balance → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me/balance",
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /rewards → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/rewards",
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /members → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /events → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { cookie: memberCookie, "idempotency-key": `m0p-mev-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /members/:id (another member) → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/members/${otherMemberId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("M0 route policy — anonymous is rejected", () => {
  it("POST /events → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "idempotency-key": `m0p-an-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /members → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/members" });
    expect(res.statusCode).toBe(401);
  });
});

describe("M0 route policy — SERVER scope is allowed", () => {
  it("POST /events → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...serverHeaders(), "idempotency-key": `m0p-sev-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("GET /members → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: serverHeaders(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("M0 route policy — admin roles on non-admin routes", () => {
  it("ANALYST GET /members → 200 (read allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: { cookie: adminCookies.ANALYST },
    });
    expect(res.statusCode).toBe(200);
  });

  it("ANALYST POST /events → 403 (read-only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { cookie: adminCookies.ANALYST, "idempotency-key": `m0p-anl-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("OPERATOR POST /events → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { cookie: adminCookies.OPERATOR, "idempotency-key": `m0p-op-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("SUPER_ADMIN POST /events → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { cookie: adminCookies.SUPER_ADMIN, "idempotency-key": `m0p-sa-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(201);
  });
});

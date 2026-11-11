import { createHash, randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import { ADMIN_ROLES } from "@loyaltyos/permissions";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, HTTPMethods } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { coalitionService } from "../lib/coalition-setup.js";
import { PRINCIPALS, routePolicy } from "../lib/route-policy.js";
import type { PolicyEntry, Principal } from "../lib/route-policy.js";

// M0 point 1 — deny-by-default route policy for non-/admin routes.
//
// The auth plugin resolves a principal (CLIENT / MEMBER / SERVER / admin role)
// but nothing enforces its scope on non-admin routes, so a CLIENT API key or a
// member session can call any endpoint. `routePolicy` (enforced by the
// route-policy preHandler plugin) maps every non-admin route to the principals
// allowed to reach it, plus a "SELF" marker for member-scoped `:id` routes.
//
//   anonymous              → 401 (auth plugin)
//   CLIENT                 → read-only rewards catalog (GET /rewards, GET /rewards/:id)
//   MEMBER                 → self-only (/members/me*) + catalog + redeem self + own :id
//   SERVER                 → everything
//   ANALYST                → read-only (GET only on non-admin routes)
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

// ── Principal sets ──────────────────────────────────────────────────────────

type Principal2 = Exclude<Principal, "anonymous">;

const P_ALL: readonly Principal2[] = [
  "CLIENT",
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];
const P_MEMBER_SELF: readonly Principal2[] = [
  "MEMBER",
  "SERVER",
  "ANALYST",
  "OPERATOR",
  "SUPER_ADMIN",
];
const P_READ: readonly Principal2[] = ["SERVER", "ANALYST", "OPERATOR", "SUPER_ADMIN"];
const P_MUTATE: readonly Principal2[] = ["SERVER", "OPERATOR", "SUPER_ADMIN"];
const P_REDEEM: readonly Principal2[] = ["MEMBER", "SERVER", "OPERATOR", "SUPER_ADMIN"];
const P_SERVER: readonly Principal2[] = ["SERVER"];

const NON_ANONYMOUS = PRINCIPALS.filter((p): p is Principal2 => p !== "anonymous");

// ── Declarative route table (the point-1 spec) ──────────────────────────────
//
// `allow` lists the principals permitted to reach the route directly. `self`
// marks a member-scoped route where MEMBER may additionally reach it only when
// the `:id` path param equals their own memberId.

type RouteEntry = {
  method: HTTPMethods;
  url: string;
  allow: readonly Principal2[];
  self?: boolean;
  idem?: boolean;
  body?: (caseId: string) => Record<string, unknown>;
};

const ROUTES: readonly RouteEntry[] = [
  // Members
  {
    method: "POST",
    url: "/api/v1/members",
    allow: P_MUTATE,
    body: (k) => ({ email: `m0p-mx-${k}@loyaltyos.dev` }),
  },
  { method: "GET", url: "/api/v1/members", allow: P_READ },
  { method: "GET", url: "/api/v1/members/me", allow: P_MEMBER_SELF },
  {
    method: "PATCH",
    url: "/api/v1/members/me",
    allow: P_MEMBER_SELF,
    body: () => ({ locale: "en-US" }),
  },
  { method: "GET", url: "/api/v1/members/:id", allow: P_READ, self: true },
  {
    method: "PATCH",
    url: "/api/v1/members/:id",
    allow: P_MUTATE,
    body: () => ({ firstName: "Matrix" }),
  },
  { method: "GET", url: "/api/v1/members/me/balance", allow: P_MEMBER_SELF },
  { method: "GET", url: "/api/v1/members/me/transactions", allow: P_MEMBER_SELF },
  { method: "GET", url: "/api/v1/members/me/badges", allow: P_MEMBER_SELF },
  { method: "GET", url: "/api/v1/members/me/tier", allow: P_MEMBER_SELF },
  { method: "GET", url: "/api/v1/members/:id/balance", allow: P_READ, self: true },
  { method: "GET", url: "/api/v1/members/:id/transactions", allow: P_READ, self: true },
  {
    method: "POST",
    url: "/api/v1/members/:id/adjust",
    allow: P_MUTATE,
    idem: true,
    body: () => ({ amount: 10, reason: "test" }),
  },
  { method: "GET", url: "/api/v1/members/:id/badges", allow: P_READ, self: true },
  { method: "GET", url: "/api/v1/members/:id/tier", allow: P_READ, self: true },
  {
    method: "POST",
    url: "/api/v1/members/:id/devices",
    allow: P_MUTATE,
    self: true,
    body: (k) => ({ token: `tok-${k}`, platform: "WEB" }),
  },
  { method: "DELETE", url: "/api/v1/members/:id/devices/:deviceId", allow: P_MUTATE, self: true },
  { method: "GET", url: "/api/v1/members/:id/preferences", allow: P_READ, self: true },
  {
    method: "PATCH",
    url: "/api/v1/members/:id/preferences",
    allow: P_MUTATE,
    self: true,
    body: () => ({ channel: "EMAIL", optedIn: true }),
  },
  { method: "POST", url: "/api/v1/members/:id/session-token", allow: P_SERVER },
  { method: "DELETE", url: "/api/v1/members/:id/session-tokens", allow: P_SERVER },

  // Events
  {
    method: "POST",
    url: "/api/v1/events",
    allow: P_MUTATE,
    idem: true,
    body: () => ({ type: "page_view" }),
  },

  // Coupons
  {
    method: "POST",
    url: "/api/v1/coupons/validate",
    allow: P_MUTATE,
    body: () => ({ code: "NOPE", memberId }),
  },
  {
    method: "POST",
    url: "/api/v1/coupons/redeem",
    allow: P_MUTATE,
    body: () => ({ code: "NOPE", memberId }),
  },

  // Gift cards
  {
    method: "POST",
    url: "/api/v1/giftcards/validate",
    allow: P_MUTATE,
    body: () => ({ code: "NOPE" }),
  },
  {
    method: "POST",
    url: "/api/v1/giftcards/redeem",
    allow: P_MUTATE,
    idem: true,
    body: () => ({ code: "NOPE", amount: 10, memberId }),
  },

  // Coalition
  {
    method: "POST",
    url: "/api/v1/coalition/accumulate",
    allow: P_MUTATE,
    idem: true,
    body: (k) => ({ memberId, externalMemberRef: "ext", points: 10, txRef: `tx-${k}` }),
  },
  {
    method: "POST",
    url: "/api/v1/coalition/redeem",
    allow: P_MUTATE,
    idem: true,
    body: (k) => ({ memberId, externalMemberRef: "ext", points: 10, txRef: `tx-${k}` }),
  },
  {
    method: "POST",
    url: "/api/v1/coalition/convert",
    allow: P_MUTATE,
    idem: true,
    body: (k) => ({ memberId, externalMemberRef: "ext", ownPoints: 10, txRef: `tx-${k}` }),
  },
  {
    method: "POST",
    url: "/api/v1/coalition/reverse",
    allow: P_MUTATE,
    idem: true,
    body: (k) => ({ txRef: `tx-${k}`, reason: "test" }),
  },
  { method: "GET", url: "/api/v1/members/:id/coalition/balance", allow: P_READ, self: true },
  { method: "GET", url: "/api/v1/members/:id/coalition/history", allow: P_READ, self: true },

  // Rewards
  { method: "GET", url: "/api/v1/rewards", allow: P_ALL },
  { method: "GET", url: "/api/v1/rewards/:id", allow: P_ALL },
  {
    method: "POST",
    url: "/api/v1/rewards/:id/redeem",
    allow: P_REDEEM,
    body: (k) => ({ rewardId, memberId, idempotencyKey: `rd-${k}` }),
  },

  // Stats
  { method: "GET", url: "/api/v1/stats/dashboard", allow: P_READ },
];

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

  // Ample balance so the matrix's redeem cases (and the foreign-memberId test)
  // can exercise the deduction path without draining the account to zero.
  await prisma.pointAccount.create({
    data: { memberId, programId, balance: 10000, totalEarned: 10000 },
  });
  // The foreign member has a known balance so "saldo ajeno intacto" is provable.
  await prisma.pointAccount.create({
    data: { memberId: otherMemberId, programId, balance: 70, totalEarned: 70 },
  });

  for (const role of ADMIN_ROLES) {
    adminCookies[role] = await loginAs(role);
  }

  // Mock coalition adapter so a SERVER-key accumulate can actually succeed.
  coalitionService.registerAdapter({
    name: "M0RP_ATTACK",
    timeoutMs: 10000,
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
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.program.delete({ where: { id: programId } }).catch(() => {});
  await app.close();
});

// ── Contract: the declarative table matches reality ─────────────────────────

describe("M0 route policy — contract", () => {
  it("the declarative ROUTES table covers every in-scope route and nothing extra", () => {
    const registered = app.routeCatalog
      .filter(isInScope)
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    const declared = ROUTES.map((r) => `${r.method} ${r.url}`).sort();
    expect(declared).toEqual(registered);
  });

  it("routePolicy matches the declarative allow/self table for every route", () => {
    for (const route of ROUTES) {
      const actual = routePolicy(route.method, route.url);
      const expected: PolicyEntry[] = [...route.allow, ...(route.self ? (["SELF"] as const) : [])];
      expect([...actual].sort(), `${route.method} ${route.url}`).toEqual([...expected].sort());
    }
  });
});

// ── Behavioral matrix: one case per (route × principal) → code ──────────────

type MatrixCase = {
  id: string;
  name: string;
  route: RouteEntry;
  principal: Principal2;
  idScope: "own" | "other" | "none";
  allowed: boolean;
};

const matrixCases: MatrixCase[] = [];
ROUTES.forEach((route, ri) => {
  for (const principal of NON_ANONYMOUS) {
    if (route.self && principal === "MEMBER") {
      matrixCases.push({
        id: `c${ri}-${principal}-own`,
        name: `${route.method} ${route.url} × MEMBER (own id) → allowed`,
        route,
        principal,
        idScope: "own",
        allowed: true,
      });
      matrixCases.push({
        id: `c${ri}-${principal}-other`,
        name: `${route.method} ${route.url} × MEMBER (other id) → 403`,
        route,
        principal,
        idScope: "other",
        allowed: false,
      });
    } else {
      // adminRbacPlugin enforces ANALYST read-only on non-admin routes, so a
      // non-GET route is denied for ANALYST even where routePolicy lists it.
      const allowed =
        route.allow.includes(principal) && !(principal === "ANALYST" && route.method !== "GET");
      matrixCases.push({
        id: `c${ri}-${principal}`,
        name: `${route.method} ${route.url} × ${principal} → ${allowed ? "allowed" : "403"}`,
        route,
        principal,
        idScope: "none",
        allowed,
      });
    }
  }
});

function headersFor(c: MatrixCase): Record<string, string> {
  const h: Record<string, string> = {};
  switch (c.principal) {
    case "CLIENT":
      h["x-api-key"] = clientKey;
      h["x-program-id"] = programId;
      break;
    case "SERVER":
      h["x-api-key"] = serverKey;
      h["x-program-id"] = programId;
      break;
    case "MEMBER":
      h.cookie = memberCookie;
      break;
    default:
      h.cookie = adminCookies[c.principal];
  }
  if (c.route.idem) h["idempotency-key"] = `m0p-${c.id}`;
  return h;
}

async function injectCase(c: MatrixCase) {
  let url = c.route.url;

  // :deviceId needs a real device owned by the target member.
  if (url.includes(":deviceId")) {
    const targetId = c.idScope === "other" ? otherMemberId : memberId;
    const dev = await prisma.memberDevice.create({
      data: { memberId: targetId, programId, token: `dev-${c.id}`, platform: "WEB" },
    });
    url = url.replace(":deviceId", dev.id);
  }

  // :id is a reward id on reward routes, a member id everywhere else.
  if (url.includes(":id")) {
    if (url.startsWith("/api/v1/rewards/")) {
      url = url.replace(":id", rewardId);
    } else {
      url = url.replace(":id", c.idScope === "other" ? otherMemberId : memberId);
    }
  }

  const options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: Record<string, unknown>;
  } = { method: c.route.method, url, headers: headersFor(c) };
  if (c.route.body) options.payload = c.route.body(c.id);

  return app.inject(options);
}

describe("M0 route policy — behavioral matrix", () => {
  it.each(matrixCases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const res = await injectCase(c);
    if (c.allowed) {
      // The route policy must not block it; the handler then decides its own
      // code (200/201/400/404…) which is covered by each route's own tests.
      expect(res.statusCode).not.toBe(403);
    } else {
      expect(res.statusCode).toBe(403);
    }
  });
});

// ── Focused checks (stronger assertions than the matrix) ────────────────────

describe("M0 route policy — MEMBER self-gating", () => {
  it("GET /members/:id own id → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/members/${memberId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /members/:id other id → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/members/${otherMemberId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /members/:id (own id) → 403 (members may not patch profiles via :id)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/members/${memberId}`,
      headers: { cookie: memberCookie },
      payload: { firstName: "Hacked" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("M0 route policy — redeem is scoped to the caller", () => {
  it("MEMBER redeeming with a foreign body.memberId deducts own points, foreign balance intact", async () => {
    const ownBefore = await prisma.pointAccount.findUnique({ where: { memberId } });
    const otherBefore = await prisma.pointAccount.findUnique({
      where: { memberId: otherMemberId },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/rewards/${rewardId}/redeem`,
      headers: { cookie: memberCookie },
      // Attacker-controlled body points at another member; must be ignored.
      payload: { rewardId, memberId: otherMemberId, idempotencyKey: `rd-foreign-${suffix}` },
    });

    expect(res.statusCode).toBe(201);

    const ownAfter = await prisma.pointAccount.findUnique({ where: { memberId } });
    const otherAfter = await prisma.pointAccount.findUnique({ where: { memberId: otherMemberId } });

    // 50 points (reward cost) deducted from the caller, not the foreign member.
    expect(ownAfter?.balance).toBe((ownBefore?.balance ?? 0) - 50);
    expect(otherAfter?.balance).toBe(otherBefore?.balance);
    expect(otherAfter?.balance).toBe(70);
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

// ── Point 1: resolvePrincipal has no SERVER fallback ────────────────────────

describe("M0 route policy — resolvePrincipal has no fallback", () => {
  it("API key with an unknown scope is denied (403) on a MUTATE route", async () => {
    const bogusKey = await prisma.apiKey.create({
      data: { programId, key: `bogus_${suffix}`, scope: "NOT_A_REAL_SCOPE" },
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-api-key": bogusKey.key, "x-program-id": programId },
        payload: { type: "page_view" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await prisma.apiKey.delete({ where: { id: bogusKey.id } }).catch(() => {});
    }
  });

  it("an authenticated admin with a null role is denied (403) on a MUTATE route", async () => {
    // The AdminRole Prisma enum cannot store an invalid role, so the "admin with
    // null role" path is defensive. Simulate it (adminId set, adminRole null)
    // with an onRequest hook on a throwaway app; auth still passes via a valid
    // SERVER key, but resolvePrincipal must key off adminId/role — not fall back
    // to SERVER.
    const probe = await buildApp({ logger: false });
    probe.addHook("onRequest", async (request) => {
      request.adminId = "defensive-admin";
      request.adminRole = null;
      request.programId = programId;
      request.apiKeyScope = "SERVER";
    });
    await probe.ready();
    try {
      const res = await probe.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-api-key": serverKey, "x-program-id": programId },
        payload: { type: "page_view" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await probe.close();
    }
  });
});

// ── Point 2: undeclared routes are denied ───────────────────────────────────

describe("M0 route policy — undeclared routes are denied", () => {
  it("routePolicy returns [] for a route not in the policy table", () => {
    expect(routePolicy("GET", "/api/v1/something/undeclared")).toEqual([]);
    expect(routePolicy("POST", "/api/v1/something/undeclared")).toEqual([]);
  });

  it("a route registered only in test returns 403 for every principal", async () => {
    const probe = await buildApp({ logger: false });
    probe.get("/api/v1/secret-undeclared", async () => ({ ok: true }));
    await probe.ready();

    const headersForPrincipal = (p: Principal2): Record<string, string> => {
      switch (p) {
        case "CLIENT":
          return { "x-api-key": clientKey, "x-program-id": programId };
        case "SERVER":
          return { "x-api-key": serverKey, "x-program-id": programId };
        case "MEMBER":
          return { cookie: memberCookie };
        default:
          return { cookie: adminCookies[p] };
      }
    };

    try {
      for (const p of NON_ANONYMOUS) {
        const res = await probe.inject({
          method: "GET",
          url: "/api/v1/secret-undeclared",
          headers: headersForPrincipal(p),
        });
        expect(res.statusCode, `${p} should be denied`).toBe(403);
      }
    } finally {
      await probe.close();
    }
  });
});

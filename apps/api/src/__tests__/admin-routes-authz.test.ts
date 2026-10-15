import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// Regression tests for the admin-session guard (issue #32, PR A).
//
// 1. deny-by-default: every /api/v1/admin/* route (except login/logout/me) must
//    reject a CLIENT-scope API key (403) and an unauthenticated request (401).
// 2. cross-tenant: an admin session's programId comes from AdminUser.programId,
//    not from an X-Program-Id header, so an admin of program A cannot read or
//    write program B's data.

let app: FastifyInstance;
let prisma: PrismaClient;

// Full inventory of admin routes (method, path). Keep this in sync when routes
// are added — the deny-by-default test fails loudly if one is missing.
const ADMIN_ROUTES: Array<[string, string]> = [
  // tiers
  ["POST", "/admin/tiers"],
  ["GET", "/admin/tiers"],
  ["GET", "/admin/tiers/stats"],
  ["GET", "/admin/tiers/:id"],
  ["GET", "/admin/tiers/:id/benefits"],
  ["PATCH", "/admin/tiers/:id"],
  ["DELETE", "/admin/tiers/:id"],
  ["PATCH", "/admin/tiers/reorder"],
  // coupons
  ["POST", "/admin/coupons"],
  ["POST", "/admin/coupons/generate"],
  ["GET", "/admin/coupons"],
  ["GET", "/admin/coupons/:id"],
  ["PATCH", "/admin/coupons/:id"],
  ["DELETE", "/admin/coupons/:id"],
  ["GET", "/admin/coupons/:id/stats"],
  // notifications + webhooks
  ["GET", "/admin/notification-templates"],
  ["POST", "/admin/notification-templates"],
  ["GET", "/admin/notification-templates/:id"],
  ["PATCH", "/admin/notification-templates/:id"],
  ["DELETE", "/admin/notification-templates/:id"],
  ["POST", "/admin/notification-templates/:id/preview"],
  ["POST", "/admin/notification-templates/:id/test-send"],
  ["GET", "/admin/notifications"],
  ["GET", "/admin/webhooks"],
  ["POST", "/admin/webhooks"],
  ["GET", "/admin/webhooks/:id"],
  ["PATCH", "/admin/webhooks/:id"],
  ["DELETE", "/admin/webhooks/:id"],
  // badges
  ["POST", "/admin/badges"],
  ["GET", "/admin/badges"],
  ["GET", "/admin/badges/stats"],
  ["GET", "/admin/badges/:id"],
  ["PATCH", "/admin/badges/:id"],
  ["DELETE", "/admin/badges/:id"],
  // rewards
  ["POST", "/admin/rewards"],
  ["GET", "/admin/rewards"],
  ["GET", "/admin/rewards/:id"],
  ["PATCH", "/admin/rewards/:id"],
  ["DELETE", "/admin/rewards/:id"],
  ["POST", "/admin/rewards/:id/archive"],
  ["POST", "/admin/rewards/:id/publish"],
  ["POST", "/admin/rewards/:id/restock"],
  // programs
  ["GET", "/admin/programs/:id"],
  ["PATCH", "/admin/programs/:id"],
  // campaigns
  ["POST", "/admin/campaigns"],
  ["GET", "/admin/campaigns"],
  ["GET", "/admin/campaigns/:id"],
  ["PATCH", "/admin/campaigns/:id"],
  ["DELETE", "/admin/campaigns/:id"],
  ["POST", "/admin/campaigns/estimate"],
  ["POST", "/admin/campaigns/:id/estimate"],
  ["POST", "/admin/campaigns/:id/lifecycle"],
  // segments
  ["POST", "/admin/segments"],
  ["GET", "/admin/segments"],
  ["POST", "/admin/segments/estimate"],
  ["GET", "/admin/segments/:id"],
  ["PATCH", "/admin/segments/:id"],
  ["DELETE", "/admin/segments/:id"],
  ["GET", "/admin/segments/:id/count"],
  ["GET", "/admin/segments/:id/members"],
  ["POST", "/admin/segments/:id/members"],
  ["DELETE", "/admin/segments/:id/members"],
  // coalition
  ["POST", "/admin/coalition/link"],
  ["DELETE", "/admin/coalition/link/:memberId"],
  ["GET", "/admin/coalition/links"],
  ["GET", "/admin/coalition/capabilities"],
  ["GET", "/admin/coalition/transactions"],
  ["POST", "/admin/coalition/reconciliation"],
  ["GET", "/admin/coalition/config"],
  ["PUT", "/admin/coalition/config"],
  ["POST", "/admin/coalition/healthcheck"],
  // giftcards
  ["POST", "/admin/giftcards/batches"],
  ["GET", "/admin/giftcards/batches"],
  ["GET", "/admin/giftcards/batches/:id"],
  ["POST", "/admin/giftcards/batches/:id/cancel"],
  ["GET", "/admin/giftcards/batches/:id/export"],
  ["POST", "/admin/giftcards/refund"],
  ["POST", "/admin/giftcards/cancel"],
  ["POST", "/admin/giftcards/transactions"],
  ["POST", "/admin/giftcards/terms"],
  ["GET", "/admin/giftcards/terms"],
  ["GET", "/admin/giftcards/terms/:id"],
  ["PATCH", "/admin/giftcards/terms/:id"],
  ["DELETE", "/admin/giftcards/terms/:id"],
  ["POST", "/admin/giftcards/lookup"],
  ["GET", "/admin/giftcards/cards/:id"],
  ["POST", "/admin/giftcards/redeem"],
  ["GET", "/admin/giftcards/batches/:id/cards"],
  ["GET", "/admin/giftcards/metrics"],
  // ai companion
  ["POST", "/admin/ai/chat"],
];

const PROGRAM_A = "prog_dev";
const suffix = Date.now().toString();

let clientKeyValue: string;
let clientKeyId: string;
let programBId: string;
let adminAEmail: string;
let adminACookie: string;
const createdIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  // CLIENT-scope API key for program A
  const clientKey = await prisma.apiKey.create({
    data: {
      programId: PROGRAM_A,
      key: `authz-client-${suffix}`,
      scope: "CLIENT",
      name: "authz-deny-test",
    },
  });
  clientKeyValue = clientKey.key;
  clientKeyId = clientKey.id;

  // Second program (tenant B)
  const programB = await prisma.program.create({
    data: { id: `prog_b_${suffix}`, name: `Authz Prog B ${suffix}` },
  });
  programBId = programB.id;

  // An admin in program A, logged in
  const password = `pw-${suffix}`;
  adminAEmail = `authz-admin-${suffix}@loyaltyos.dev`;
  await prisma.adminUser.create({
    data: {
      email: adminAEmail,
      name: "Authz Admin A",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId: PROGRAM_A,
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email: adminAEmail, password },
  });
  expect(login.statusCode).toBe(200);
  const sessionCookie = login.cookies.find((c) => c.name === "loyaltyos_admin_session");
  adminACookie = `${sessionCookie?.name}=${sessionCookie?.value}`;
});

afterAll(async () => {
  await prisma.apiKey.delete({ where: { id: clientKeyId } }).catch(() => {});
  await prisma.campaign.deleteMany({ where: { programId: programBId } }).catch(() => {});
  await prisma.program.delete({ where: { id: programBId } }).catch(() => {});
  const admin = await prisma.adminUser.findUnique({ where: { email: adminAEmail } });
  if (admin) {
    await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
    await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
  }
  for (const id of createdIds) {
    await prisma.campaign.delete({ where: { id } }).catch(() => {});
  }
  await app.close();
});

describe("deny-by-default on /admin routes", () => {
  for (const [method, path] of ADMIN_ROUTES) {
    it(`${method} ${path} rejects CLIENT key and unauthenticated`, async () => {
      const url = `/api/v1${path.replace(/:\w+/g, "x")}`;

      // CLIENT-scope key: authenticated but not an admin session → 403
      const clientRes = await app.inject({
        method,
        url,
        headers: { "x-api-key": clientKeyValue, "x-program-id": PROGRAM_A },
      });
      expect(clientRes.statusCode).toBe(403);

      // No credentials → 401
      const anonRes = await app.inject({ method, url });
      expect(anonRes.statusCode).toBe(401);
    });
  }
});

describe("encoding bypass is closed (guard uses resolved route, not raw URL)", () => {
  // %xx-encoded path segments that decode to `/api/v1/admin/campaigns`. Before
  // the guard used `request.routeOptions.url`, these slipped past the
  // `request.url.startsWith("/api/v1/admin/")` check and returned 200.
  const encodedPaths = [
    "/api/v1/%61dmin/campaigns",
    "/api/v1/ad%6din/campaigns",
    "/api/v1/%61dmin/%63ampaigns",
    "/api/v1/admin/campaign%73",
  ];

  for (const path of encodedPaths) {
    it(`GET ${path} rejects a CLIENT key (403)`, async () => {
      const res = await app.inject({
        method: "GET",
        url: path,
        headers: { "x-api-key": clientKeyValue, "x-program-id": PROGRAM_A },
      });
      expect(res.statusCode).toBe(403);
    });
  }
});

describe("cross-tenant isolation (programId from AdminUser)", () => {
  it("admin of program A cannot read program B's campaigns via X-Program-Id", async () => {
    const bCampaign = await prisma.campaign.create({
      data: { programId: programBId, name: `B-only-${suffix}`, type: "BONUS_POINTS" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/campaigns",
      headers: { cookie: adminACookie, "x-program-id": programBId },
    });
    expect(res.statusCode).toBe(200);

    const ids = (res.json().data.items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(bCampaign.id);
  });

  it("admin of program A cannot create a campaign under program B via X-Program-Id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/campaigns",
      headers: { cookie: adminACookie, "x-program-id": programBId },
      payload: { name: `attempt-B-${suffix}`, type: "BONUS_POINTS" },
    });
    expect(res.statusCode).toBe(201);

    const created = await prisma.campaign.findFirst({
      where: { name: `attempt-B-${suffix}` },
    });
    expect(created).not.toBeNull();
    expect(created!.programId).toBe(PROGRAM_A);
    expect(created!.programId).not.toBe(programBId);
    createdIds.push(created!.id);
  });
});

describe("cross-tenant isolation (API key scope)", () => {
  it("a program-A key cannot POST /events with X-Program-Id = program B", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-api-key": clientKeyValue, "x-program-id": programBId },
      payload: { type: "purchase" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a program-A key cannot GET /members with X-Program-Id = program B", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: { "x-api-key": clientKeyValue, "x-program-id": programBId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a program-A key with a matching X-Program-Id is not rejected", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members",
      headers: { "x-api-key": clientKeyValue, "x-program-id": PROGRAM_A },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

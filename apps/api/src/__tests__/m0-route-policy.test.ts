import { createHash, randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import { ADMIN_ROLES } from "@loyaltyos/permissions";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// M0 point 1 — deny-by-default route policy for non-/admin routes.
//
// The current API resolves a principal (CLIENT / MEMBER / SERVER / admin) but
// never enforces its scope on non-admin routes, so a CLIENT API key or a member
// session can call any endpoint. These tests encode the target policy and are
// expected to fail today (red).

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

  for (const role of ADMIN_ROLES) {
    adminCookies[role] = await loginAs(role);
  }
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.magicLinkToken
    .deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.session
    .deleteMany({ where: { userId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.rewardRedemption
    .deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.pointTransaction
    .deleteMany({ where: { account: { memberId: { in: [memberId, otherMemberId] } } } })
    .catch(() => {});
  await prisma.pointAccount
    .deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } })
    .catch(() => {});
  await prisma.reward.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.event.deleteMany({ where: { programId } }).catch(() => {});
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

describe("M0 route policy — CLIENT scope is read-only (rewards catalog)", () => {
  it("POST /events → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...clientHeaders(), "idempotency-key": `m0p-ev-${suffix}` },
      payload: { type: "page_view" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /coalition/accumulate → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coalition/accumulate",
      headers: { ...clientHeaders(), "idempotency-key": `m0p-co-${suffix}` },
      payload: { memberId, externalMemberRef: "ext-1", points: 10, txRef: "tx-client-1" },
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

  it("POST /rewards/:id/redeem → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/rewards/${rewardId}/redeem`,
      headers: clientHeaders(),
      payload: { rewardId, memberId, idempotencyKey: `m0p-rd-${suffix}` },
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

  it("GET /rewards → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/rewards",
      headers: clientHeaders(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("M0 route policy — MEMBER scope is self-only", () => {
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

  it("GET /members/me → 200 (allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/members/me",
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
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
});

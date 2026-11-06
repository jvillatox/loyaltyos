import { randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// M0 point 3 — cross-program isolation. With program A credentials, an id (or
// code) that belongs to program B must resolve to 404 and must leave B's rows
// untouched. Today the by-id lookups filter only on `id`, so a request from A
// can read (and mutate) B's data.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const progA = `progA_m0i_${suffix}`;
const progB = `progB_m0i_${suffix}`;
const aServerKey = `ak_${suffix}`;

let aAdminCookie = "";
let aAdminId = "";

let bMemberId = "";
let bRewardId = "";
let bCouponId = "";
let bCouponCode = "";
let bTierId = "";
let bTemplateId = "";

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: progA, name: `M0I A ${suffix}` } });
  await prisma.program.create({ data: { id: progB, name: `M0I B ${suffix}` } });

  await prisma.apiKey.create({ data: { programId: progA, key: aServerKey, scope: "SERVER" } });

  // Admin in program A (SUPER_ADMIN can reach every admin by-id route).
  const email = `m0i-admin-${suffix}@loyaltyos.dev`;
  const password = `pw-${suffix}`;
  const admin = await prisma.adminUser.create({
    data: {
      email,
      name: "M0I Admin",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId: progA,
    },
  });
  aAdminId = admin.id;
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  expect(login.statusCode).toBe(200);
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  aAdminCookie = `${c?.name}=${c?.value}`;

  // Resources in program B.
  const member = await prisma.member.create({
    data: { email: `m0i-member-${suffix}@loyaltyos.dev`, programId: progB },
  });
  bMemberId = member.id;

  const reward = await prisma.reward.create({
    data: { programId: progB, name: `M0I Reward ${suffix}`, pointsCost: 50 },
  });
  bRewardId = reward.id;

  bCouponCode = `M0ICODE${suffix}`;
  const coupon = await prisma.coupon.create({
    data: {
      programId: progB,
      code: bCouponCode,
      mode: "SHARED",
      discountType: "PERCENTAGE",
      discountValue: 10,
    },
  });
  bCouponId = coupon.id;

  const tier = await prisma.tier.create({
    data: { programId: progB, name: `M0I Tier ${suffix}`, rank: 1 },
  });
  bTierId = tier.id;

  const template = await prisma.notificationTemplate.create({
    data: { programId: progB, name: `M0I Template ${suffix}`, channel: "EMAIL" },
  });
  bTemplateId = template.id;
});

afterAll(async () => {
  await prisma.auditLog
    .deleteMany({ where: { programId: { in: [progA, progB] } } })
    .catch(() => {});
  await prisma.notificationTemplate.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.tier.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.coupon.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.reward.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { programId: progA } }).catch(() => {});
  const admin = await prisma.adminUser.findUnique({
    where: { email: `m0i-admin-${suffix}@loyaltyos.dev` },
  });
  if (admin) {
    await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
    await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
  }
  await prisma.program.deleteMany({ where: { id: { in: [progA, progB] } } }).catch(() => {});
  await app.close();
});

const aServerHeaders = { "x-api-key": aServerKey, "x-program-id": progA };
const aAdminHeaders = () => ({ cookie: aAdminCookie });

describe("M0 isolation — program A cannot reach program B by id", () => {
  it("PATCH /members/:id (B member) → 404 and B unchanged", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/members/${bMemberId}`,
      headers: aServerHeaders,
      payload: { firstName: "HACKED" },
    });
    expect(res.statusCode).toBe(404);

    const after = await prisma.member.findUnique({ where: { id: bMemberId } });
    expect(after?.firstName ?? null).toBeNull();
  });

  it("GET /admin/rewards/:id (B reward) → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/rewards/${bRewardId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /admin/coupons/:id (B coupon) → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/coupons/${bCouponId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /admin/tiers/:id (B tier) → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/tiers/${bTierId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /admin/notification-templates/:id (B template) → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/notification-templates/${bTemplateId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /coupons/validate (B code) → not found for A", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coupons/validate",
      headers: aServerHeaders,
      payload: { code: bCouponCode, memberId: "any-member" },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { valid: boolean } };
    expect(data.valid).toBe(false);
  });
});

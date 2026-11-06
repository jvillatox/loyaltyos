import { randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { coalitionService } from "../lib/coalition-setup.js";

// M0 point 3 (writes) — cross-program isolation on write paths.
//
// These cover the write routes the by-id read test does not: coalition reverse,
// a foreign `body.memberId` on events / coalition accumulate / rewards redeem,
// and one admin write route per model. With program A credentials, an id (or
// txRef, or body.memberId) that belongs to program B must resolve to 404 and
// must leave B's rows untouched. Today the lookups are global (or the memberId
// is trusted), so A can mutate B's data.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const progA = `progA_m0w_${suffix}`;
const progB = `progB_m0w_${suffix}`;
const aServerKey = `akw_${suffix}`;

let aAdminCookie = "";

let bMemberId = "";
let bRewardId = "";
let bCouponId = "";
let bCampaignId = "";
let bSegmentId = "";
let bBadgeId = "";
let bTierId = "";
let bTemplateId = "";
let bWebhookId = "";
let bTermsId = "";
let bBatchId = "";
let bTxId = "";
const bTxRef = `tx-b-${suffix}`;

let reverseCalls = 0;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: progA, name: `M0W A ${suffix}` } });
  await prisma.program.create({ data: { id: progB, name: `M0W B ${suffix}` } });

  await prisma.apiKey.create({ data: { programId: progA, key: aServerKey, scope: "SERVER" } });

  // Admin in program A (SUPER_ADMIN reaches every admin by-id route).
  const email = `m0w-admin-${suffix}@loyaltyos.dev`;
  const password = `pw-${suffix}`;
  const admin = await prisma.adminUser.create({
    data: {
      email,
      name: "M0W Admin",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId: progA,
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  aAdminCookie = `${c?.name}=${c?.value}`;

  // ── Resources in program B ──────────────────────────────────────────────
  const bMember = await prisma.member.create({
    data: { email: `m0w-member-${suffix}@loyaltyos.dev`, programId: progB },
  });
  bMemberId = bMember.id;
  await prisma.pointAccount.create({
    data: { memberId: bMemberId, programId: progB, balance: 100, totalEarned: 100 },
  });

  const bReward = await prisma.reward.create({
    data: { programId: progB, name: `M0W Reward ${suffix}`, pointsCost: 50 },
  });
  bRewardId = bReward.id;

  const bCoupon = await prisma.coupon.create({
    data: {
      programId: progB,
      code: `M0WCODE${suffix}`,
      mode: "SHARED",
      discountType: "PERCENTAGE",
      discountValue: 10,
    },
  });
  bCouponId = bCoupon.id;

  const bCampaign = await prisma.campaign.create({
    data: { programId: progB, name: `M0W Campaign ${suffix}`, type: "BONUS_POINTS" },
  });
  bCampaignId = bCampaign.id;

  const bSegment = await prisma.segment.create({
    data: { programId: progB, name: `M0W Segment ${suffix}`, type: "DYNAMIC" },
  });
  bSegmentId = bSegment.id;

  const bBadge = await prisma.badge.create({
    data: { programId: progB, name: `M0W Badge ${suffix}`, type: "ACHIEVEMENT" },
  });
  bBadgeId = bBadge.id;

  const bTier = await prisma.tier.create({
    data: { programId: progB, name: `M0W Tier ${suffix}`, rank: 1 },
  });
  bTierId = bTier.id;

  const bTemplate = await prisma.notificationTemplate.create({
    data: { programId: progB, name: `M0W Template ${suffix}`, channel: "EMAIL" },
  });
  bTemplateId = bTemplate.id;

  const bWebhook = await prisma.webhookSubscription.create({
    data: {
      programId: progB,
      url: "https://example.invalid/hook",
      events: ["member.created"],
      secret: "b-webhook-secret-16",
    },
  });
  bWebhookId = bWebhook.id;

  const bTerms = await prisma.termsTemplate.create({
    data: { programId: progB, name: `M0W Terms ${suffix}`, locale: "es-MX", body: "terms body" },
  });
  bTermsId = bTerms.id;

  // Batch requires a creator admin (FK) + a terms template.
  const bAdmin = await prisma.adminUser.create({
    data: {
      email: `m0w-badmin-${suffix}@loyaltyos.dev`,
      name: "M0W B Admin",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId: progB,
    },
  });
  const bBatch = await prisma.giftCardBatch.create({
    data: {
      programId: progB,
      name: `M0W Batch ${suffix}`,
      quantity: 1,
      initialAmount: 10,
      currency: "MXN",
      expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      termsTemplateId: bTermsId,
      createdById: bAdmin.id,
      status: "ready",
    },
  });
  bBatchId = bBatch.id;

  // ── Coalition: A (accumulate attack) + B (reverse target) ────────────────
  coalitionService.registerAdapter({
    name: "M0W_A",
    capabilities: {
      accumulate: true,
      redeem: false,
      convert: false,
      reverseTransaction: false,
      historyQuery: false,
    },
    healthcheck: async () => ({ ok: true }),
    getBalance: async () => 0,
    accumulate: async () => ({ externalTxId: "ext-a", balanceAfter: 10 }),
  });
  await prisma.coalitionConfig.create({
    data: {
      programId: progA,
      provider: "M0W_A",
      endpoint: "https://example.invalid",
      encryptedCredentials: "x",
      accumulationEnabled: true,
    },
  });

  coalitionService.registerAdapter({
    name: "M0W_REVERSE",
    capabilities: {
      accumulate: false,
      redeem: false,
      convert: false,
      reverseTransaction: true,
      historyQuery: false,
    },
    healthcheck: async () => ({ ok: true }),
    getBalance: async () => 0,
    accumulate: async () => ({ externalTxId: "unused", balanceAfter: 0 }),
    reverseTransaction: async () => {
      reverseCalls += 1;
    },
  });
  await prisma.coalitionConfig.create({
    data: {
      programId: progB,
      provider: "M0W_REVERSE",
      endpoint: "https://example.invalid",
      encryptedCredentials: "x",
      accumulationEnabled: true,
    },
  });
  const bCoalAccount = await prisma.coalitionAccount.create({
    data: {
      memberId: bMemberId,
      programId: progB,
      provider: "M0W_REVERSE",
      externalId: "ext-b",
    },
  });
  const bTx = await prisma.coalitionTransaction.create({
    data: {
      accountId: bCoalAccount.id,
      type: "EARN",
      amount: 10,
      localTxRef: bTxRef,
      externalTxRef: "ext-tx-b",
      status: "CONFIRMED",
      idempotencyKey: `m0w-rev-tx-${suffix}`,
    },
  });
  bTxId = bTx.id;
});

afterAll(async () => {
  await prisma.coalitionTransaction
    .deleteMany({ where: { account: { programId: { in: [progA, progB] } } } })
    .catch(() => {});
  await prisma.coalitionAccount
    .deleteMany({ where: { programId: { in: [progA, progB] } } })
    .catch(() => {});
  await prisma.coalitionConfig
    .deleteMany({ where: { programId: { in: [progA, progB] } } })
    .catch(() => {});
  await prisma.rewardRedemption.deleteMany({ where: { memberId: bMemberId } }).catch(() => {});
  await prisma.pointTransaction
    .deleteMany({ where: { account: { memberId: bMemberId } } })
    .catch(() => {});
  await prisma.pointAccount.deleteMany({ where: { memberId: bMemberId } }).catch(() => {});
  await prisma.giftCard.deleteMany({ where: { batchId: bBatchId } }).catch(() => {});
  await prisma.giftCardBatch.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.termsTemplate.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.webhookSubscription.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.notificationTemplate.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.badge.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.segment.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.campaign.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.tier.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.coupon.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.reward.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.event.deleteMany({ where: { programId: { in: [progA, progB] } } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId: progB } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { programId: progA } }).catch(() => {});
  for (const adminEmail of [
    `m0w-admin-${suffix}@loyaltyos.dev`,
    `m0w-badmin-${suffix}@loyaltyos.dev`,
  ]) {
    const a = await prisma.adminUser.findUnique({ where: { email: adminEmail } });
    if (a) {
      await prisma.adminSession.deleteMany({ where: { userId: a.id } }).catch(() => {});
      await prisma.adminUser.delete({ where: { id: a.id } }).catch(() => {});
    }
  }
  await prisma.program.deleteMany({ where: { id: { in: [progA, progB] } } }).catch(() => {});
  await app.close();
});

const aServerHeaders = () => ({ "x-api-key": aServerKey, "x-program-id": progA });
const aAdminHeaders = () => ({ cookie: aAdminCookie });

describe("M0 isolation writes — coalition reverse is program-scoped", () => {
  it("POST /coalition/reverse (B txRef, A creds) → 404 and B's tx intact", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coalition/reverse",
      headers: { ...aServerHeaders(), "idempotency-key": `m0w-rev-req-${suffix}` },
      payload: { txRef: bTxRef, reason: "test" },
    });
    expect(res.statusCode).toBe(404);

    const tx = await prisma.coalitionTransaction.findUnique({ where: { id: bTxId } });
    expect(tx?.status).toBe("CONFIRMED");
    expect(reverseCalls).toBe(0);
  });
});

describe("M0 isolation writes — foreign body.memberId with A SERVER creds", () => {
  it("POST /events (B memberId) → 404, no PointAccount/Event created in A", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { ...aServerHeaders(), "idempotency-key": `m0w-ev-${suffix}` },
      payload: { type: "purchase", memberId: bMemberId, payload: { amount: 100 } },
    });
    expect(res.statusCode).toBe(404);

    const accounts = await prisma.pointAccount.count({
      where: { memberId: bMemberId, programId: progA },
    });
    expect(accounts).toBe(0);
    const events = await prisma.event.count({
      where: { memberId: bMemberId, programId: progA },
    });
    expect(events).toBe(0);
  });

  it("POST /coalition/accumulate (B memberId) → 404, no CoalitionAccount in A", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/coalition/accumulate",
      headers: { ...aServerHeaders(), "idempotency-key": `m0w-co-${suffix}` },
      payload: {
        memberId: bMemberId,
        externalMemberRef: "ext-b",
        points: 10,
        txRef: `tx-acc-${suffix}`,
      },
    });
    expect(res.statusCode).toBe(404);

    const accounts = await prisma.coalitionAccount.count({
      where: { memberId: bMemberId, programId: progA },
    });
    expect(accounts).toBe(0);
  });

  it("POST /rewards/:id/redeem (B reward + B memberId) → 404, B balance intact", async () => {
    const before = await prisma.pointAccount.findUnique({ where: { memberId: bMemberId } });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/rewards/${bRewardId}/redeem`,
      headers: aServerHeaders(),
      payload: { rewardId: bRewardId, memberId: bMemberId, idempotencyKey: `m0w-rd-${suffix}` },
    });
    expect(res.statusCode).toBe(404);

    const after = await prisma.pointAccount.findUnique({ where: { memberId: bMemberId } });
    expect(after?.balance).toBe(before?.balance);
    const redemptions = await prisma.rewardRedemption.count({
      where: { rewardId: bRewardId, memberId: bMemberId },
    });
    expect(redemptions).toBe(0);
  });
});

describe("M0 isolation writes — admin write routes (A admin, B id) → 404, B unchanged", () => {
  it("DELETE /admin/rewards/:id → 404, B reward not deleted", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/rewards/${bRewardId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.reward.findUnique({ where: { id: bRewardId } });
    expect(row?.deletedAt).toBeNull();
  });

  it("DELETE /admin/coupons/:id → 404, B coupon not deleted", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/coupons/${bCouponId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.coupon.findUnique({ where: { id: bCouponId } });
    expect(row?.deletedAt).toBeNull();
  });

  it("DELETE /admin/campaigns/:id → 404, B campaign not deleted", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/campaigns/${bCampaignId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.campaign.findUnique({ where: { id: bCampaignId } });
    expect(row?.deletedAt).toBeNull();
  });

  it("DELETE /admin/segments/:id → 404, B segment still present", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/segments/${bSegmentId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.segment.findUnique({ where: { id: bSegmentId } })).not.toBeNull();
  });

  it("DELETE /admin/badges/:id → 404, B badge still present", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/badges/${bBadgeId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.badge.findUnique({ where: { id: bBadgeId } })).not.toBeNull();
  });

  it("DELETE /admin/tiers/:id → 404, B tier still present", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tiers/${bTierId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.tier.findUnique({ where: { id: bTierId } })).not.toBeNull();
  });

  it("DELETE /admin/webhooks/:id → 404, B webhook still present", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/webhooks/${bWebhookId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(
      await prisma.webhookSubscription.findUnique({ where: { id: bWebhookId } }),
    ).not.toBeNull();
  });

  it("DELETE /admin/notification-templates/:id → 404, B template still present", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/notification-templates/${bTemplateId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(
      await prisma.notificationTemplate.findUnique({ where: { id: bTemplateId } }),
    ).not.toBeNull();
  });

  it("DELETE /admin/giftcards/terms/:id → 404, B terms still present", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/giftcards/terms/${bTermsId}`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.termsTemplate.findUnique({ where: { id: bTermsId } })).not.toBeNull();
  });

  it("POST /admin/giftcards/batches/:id/cancel → 404, B batch not cancelled", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/giftcards/batches/${bBatchId}/cancel`,
      headers: aAdminHeaders(),
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.giftCardBatch.findUnique({ where: { id: bBatchId } });
    expect(row?.status).toBe("ready");
  });

  it("PATCH /admin/programs/:id → 404, B program unchanged", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/programs/${progB}`,
      headers: aAdminHeaders(),
      payload: { name: "HACKED" },
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.program.findUnique({ where: { id: progB } });
    expect(row?.name).toBe(`M0W B ${suffix}`);
  });
});

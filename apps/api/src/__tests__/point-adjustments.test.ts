import { randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import type { AdminRole } from "@loyaltyos/permissions";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { expirePendingAdjustments } from "../lib/point-adjustments.js";

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const programId = `prog_adj_${suffix}`;
const otherProgramId = `prog_adj2_${suffix}`;
const serverKey = `sk_adj_${suffix}`;
const clientKey = `ck_adj_${suffix}`;

let memberId = "";
let negativeMemberId = "";

const cookies = {} as Record<AdminRole, string>;
const adminIds = {} as Record<AdminRole, string>;
let otherProgramAdminCookie = "";
let keyCounter = 0;

const idemKey = (tag: string): string => `adj-${tag}-${suffix}-${keyCounter++}`;

function serverHeaders(): Record<string, string> {
  return { "x-api-key": serverKey, "x-program-id": programId };
}

async function balanceOf(targetMemberId: string): Promise<number> {
  const account = await prisma.pointAccount.findUnique({ where: { memberId: targetMemberId } });
  return account?.balance ?? 0;
}

async function loginAs(role: AdminRole, targetProgramId: string, tag: string): Promise<string> {
  const email = `adj-${role.toLowerCase()}-${tag}-${suffix}@loyaltyos.dev`;
  const password = `pw-${suffix}`;
  const admin = await prisma.adminUser.create({
    data: {
      email,
      name: `Adj ${role} ${tag}`,
      passwordHash: await hashPassword(password),
      role,
      programId: targetProgramId,
    },
  });
  if (targetProgramId === programId) adminIds[role] = admin.id;
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  return `${c?.name}=${c?.value}`;
}

async function makeOperator(tag: string): Promise<{ id: string; cookie: string }> {
  const cookie = await loginAs("OPERATOR", programId, tag);
  const admin = await prisma.adminUser.findUniqueOrThrow({
    where: { email: `adj-operator-${tag}-${suffix}@loyaltyos.dev` },
  });
  return { id: admin.id, cookie };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({
    data: {
      id: programId,
      name: `Adj ${suffix}`,
      adjustOperatorPerTxLimit: 100,
      adjustOperatorDailyLimit: 300,
      adjustServerPerTxLimit: 1000,
    },
  });
  await prisma.program.create({ data: { id: otherProgramId, name: `Adj2 ${suffix}` } });

  await prisma.apiKey.create({ data: { programId, key: serverKey, scope: "SERVER" } });
  await prisma.apiKey.create({ data: { programId, key: clientKey, scope: "CLIENT" } });

  const member = await prisma.member.create({
    data: { email: `adj-member-${suffix}@loyaltyos.dev`, programId },
  });
  memberId = member.id;

  const neg = await prisma.member.create({
    data: { email: `adj-neg-${suffix}@loyaltyos.dev`, programId },
  });
  negativeMemberId = neg.id;
  await prisma.pointAccount.create({
    data: { memberId: negativeMemberId, programId, balance: 10 },
  });

  for (const role of ["SUPER_ADMIN", "OPERATOR", "ANALYST"] as AdminRole[]) {
    cookies[role] = await loginAs(role, programId, "main");
  }
  otherProgramAdminCookie = await loginAs("SUPER_ADMIN", otherProgramId, "other");
});

afterAll(async () => {
  await prisma.pointAdjustmentRequest.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.pointTransaction
    .deleteMany({ where: { account: { memberId: { in: [memberId, negativeMemberId] } } } })
    .catch(() => {});
  await prisma.pointAccount
    .deleteMany({ where: { memberId: { in: [memberId, negativeMemberId] } } })
    .catch(() => {});
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.apiKey.deleteMany({ where: { programId } }).catch(() => {});

  const admins = await prisma.adminUser.findMany({
    where: { programId: { in: [programId, otherProgramId] } },
  });
  for (const admin of admins) {
    await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
    await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
  }
  await prisma.pointAdjustmentRequest
    .deleteMany({ where: { programId: otherProgramId } })
    .catch(() => {});
  await prisma.program
    .deleteMany({ where: { id: { in: [programId, otherProgramId] } } })
    .catch(() => {});
  await app.close();
});

describe("point adjustments — program limits", () => {
  it("defaults apply when a program does not override them", async () => {
    const program = await prisma.program.findUniqueOrThrow({ where: { id: otherProgramId } });
    expect(program.adjustOperatorPerTxLimit).toBe(1000);
    expect(program.adjustOperatorDailyLimit).toBe(5000);
    expect(program.adjustServerPerTxLimit).toBe(10000);
  });

  it("SUPER_ADMIN can edit the limits via PATCH /admin/programs/:id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/programs/${programId}`,
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: { adjustOperatorPerTxLimit: 250 },
    });
    expect(res.statusCode).toBe(200);
    const { data } = JSON.parse(res.body) as { data: { adjustOperatorPerTxLimit: number } };
    expect(data.adjustOperatorPerTxLimit).toBe(250);

    await prisma.program.update({
      where: { id: programId },
      data: { adjustOperatorPerTxLimit: 100 },
    });
  });

  it("OPERATOR cannot edit the limits (403)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/programs/${programId}`,
      headers: { cookie: cookies.OPERATOR },
      payload: { adjustOperatorPerTxLimit: 250 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("point adjustments — reason validation", () => {
  it("rejects an admin adjustment without a sufficient comment (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.SUPER_ADMIN, "idempotency-key": idemKey("nocomment") },
      payload: { amount: 10, reasonCategory: "OTHER" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("ADJUST_COMMENT_REQUIRED");
  });

  it("rejects a comment shorter than 10 characters (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.SUPER_ADMIN, "idempotency-key": idemKey("short") },
      payload: { amount: 10, reasonCategory: "OTHER", comment: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a zero amount (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.SUPER_ADMIN, "idempotency-key": idemKey("zero") },
      payload: { amount: 0, reasonCategory: "OTHER", comment: "zero adjustment" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("allows a SERVER adjustment without a comment", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { ...serverHeaders(), "idempotency-key": idemKey("srv-nocomment") },
      payload: { amount: 10, reasonCategory: "OTHER" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("point adjustments — role × caps", () => {
  it("OPERATOR within both caps applies directly (201)", async () => {
    const before = await balanceOf(memberId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-ok") },
      payload: { amount: 50, reasonCategory: "CUSTOMER_SERVICE", comment: "courtesy adjustment" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe("APPROVED");
    expect(await balanceOf(memberId)).toBe(before + 50);
  });

  it("OPERATOR over the per-transaction cap goes PENDING (202)", async () => {
    const before = await balanceOf(memberId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-over-tx") },
      payload: { amount: 150, reasonCategory: "PROMOTION", comment: "promo adjustment" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { data: { requestId: string; status: string } };
    expect(body.data.status).toBe("PENDING");
    // Nothing applied yet.
    expect(await balanceOf(memberId)).toBe(before);
  });

  it("OPERATOR over the daily cap goes PENDING (202)", async () => {
    const op = await makeOperator("daily");
    const apply = async (tag: string): Promise<number> => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/members/${memberId}/adjust`,
        headers: { cookie: op.cookie, "idempotency-key": idemKey(tag) },
        payload: { amount: 100, reasonCategory: "OTHER", comment: "daily cap test" },
      });
      return res.statusCode;
    };

    expect(await apply("d1")).toBe(201); // 100
    expect(await apply("d2")).toBe(201); // 200
    expect(await apply("d3")).toBe(201); // 300
    expect(await apply("d4")).toBe(202); // 400 > 300 → PENDING
  });

  it("SERVER within its per-transaction cap applies directly (201)", async () => {
    const before = await balanceOf(memberId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { ...serverHeaders(), "idempotency-key": idemKey("srv-ok") },
      payload: { amount: 500, reasonCategory: "ERROR_CORRECTION" },
    });
    expect(res.statusCode).toBe(201);
    expect(await balanceOf(memberId)).toBe(before + 500);
  });

  it("SERVER over its per-transaction cap is rejected (422), never pending", async () => {
    const key = idemKey("srv-over");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { ...serverHeaders(), "idempotency-key": key },
      payload: { amount: 1500, reasonCategory: "OTHER" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe("ADJUST_LIMIT_EXCEEDED");

    const pendingCount = await prisma.pointAdjustmentRequest.count({
      where: { programId, idempotencyKey: key },
    });
    expect(pendingCount).toBe(0);
  });

  it("SUPER_ADMIN adjusts directly regardless of caps (201)", async () => {
    const before = await balanceOf(memberId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.SUPER_ADMIN, "idempotency-key": idemKey("sa-big") },
      payload: { amount: 5000, reasonCategory: "FRAUD", comment: "fraud write-off" },
    });
    expect(res.statusCode).toBe(201);
    expect(await balanceOf(memberId)).toBe(before + 5000);
  });
});

describe("point adjustments — approval flow", () => {
  it("an OPERATOR cannot approve (403 via permission)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-pend1") },
      payload: { amount: 150, reasonCategory: "OTHER", comment: "needs approval" },
    });
    const { requestId } = (res.json() as { data: { requestId: string } }).data;

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${requestId}/approve`,
      headers: { cookie: cookies.OPERATOR },
      payload: {},
    });
    expect(approve.statusCode).toBe(403);
  });

  it("a SUPER_ADMIN approves a pending request and points are applied once", async () => {
    const before = await balanceOf(memberId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-pend2") },
      payload: { amount: 150, reasonCategory: "OTHER", comment: "needs approval" },
    });
    const { requestId } = (res.json() as { data: { requestId: string } }).data;

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${requestId}/approve`,
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: { decisionComment: "approved by test" },
    });
    expect(approve.statusCode).toBe(200);
    expect(await balanceOf(memberId)).toBe(before + 150);
  });

  it("double approval applies points exactly once", async () => {
    const before = await balanceOf(memberId);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-pend3") },
      payload: { amount: 150, reasonCategory: "OTHER", comment: "needs approval" },
    });
    const { requestId } = (res.json() as { data: { requestId: string } }).data;

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${requestId}/approve`,
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: {},
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${requestId}/approve`,
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: {},
    });
    expect(second.statusCode).toBe(200);

    expect(await balanceOf(memberId)).toBe(before + 150);
    const txCount = await prisma.pointTransaction.count({
      where: { idempotencyKey: `adjust-${requestId}` },
    });
    expect(txCount).toBe(1);
  });

  it("a requester cannot approve their own request (403)", async () => {
    const superAdminId = adminIds.SUPER_ADMIN;
    const created = await prisma.pointAdjustmentRequest.create({
      data: {
        programId,
        memberId,
        amount: 150,
        reasonCategory: "OTHER",
        comment: "self-approve probe",
        requestedById: superAdminId,
        requestedByType: "ADMIN_USER",
        status: "PENDING",
        idempotencyKey: `self-${suffix}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${created.id}/approve`,
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("ADJUST_SELF_DECIDE");
  });

  it("an admin from another program cannot approve (404)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-pend4") },
      payload: { amount: 150, reasonCategory: "OTHER", comment: "needs approval" },
    });
    const { requestId } = (res.json() as { data: { requestId: string } }).data;

    const cross = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${requestId}/approve`,
      headers: { cookie: otherProgramAdminCookie },
      payload: {},
    });
    expect(cross.statusCode).toBe(404);
  });

  it("a SERVER key cannot reach the approval route (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/whatever/approve`,
      headers: serverHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("point adjustments — expiry, negatives, idempotency", () => {
  it("a pending request left undecided expires and can no longer be approved", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: cookies.OPERATOR, "idempotency-key": idemKey("op-exp") },
      payload: { amount: 150, reasonCategory: "OTHER", comment: "will expire" },
    });
    const { requestId } = (res.json() as { data: { requestId: string } }).data;

    await prisma.pointAdjustmentRequest.update({
      where: { id: requestId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await expirePendingAdjustments();
    expect(expired).toBeGreaterThanOrEqual(1);

    const after = await prisma.pointAdjustmentRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(after.status).toBe("EXPIRED");

    const approve = await app.inject({
      method: "POST",
      url: `/api/v1/admin/point-adjustments/${requestId}/approve`,
      headers: { cookie: cookies.SUPER_ADMIN },
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { data: { status: string } }).data.status).toBe("EXPIRED");
  });

  it("a negative adjustment may take the balance below zero", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${negativeMemberId}/adjust`,
      headers: { ...serverHeaders(), "idempotency-key": idemKey("neg") },
      payload: { amount: -50, reasonCategory: "ERROR_CORRECTION" },
    });
    expect(res.statusCode).toBe(201);
    expect(await balanceOf(negativeMemberId)).toBe(10 - 50);
  });

  it("a repeated idempotency key returns the same request and applies once", async () => {
    const key = idemKey("idem-retry");
    const before = await balanceOf(memberId);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { ...serverHeaders(), "idempotency-key": key },
      payload: { amount: 25, reasonCategory: "OTHER" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { ...serverHeaders(), "idempotency-key": key },
      payload: { amount: 25, reasonCategory: "OTHER" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = (first.json() as { data: { requestId: string } }).data;
    const b = (second.json() as { data: { requestId: string } }).data;
    expect(b.requestId).toBe(a.requestId);

    expect(await balanceOf(memberId)).toBe(before + 25);
  });
});

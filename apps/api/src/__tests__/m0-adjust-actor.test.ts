import { randomUUID } from "node:crypto";

import { hashPassword } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";

// M0 point 2 — /members/:id/adjust must record the real actor in the audit log,
// not the hardcoded "admin". Today the handler passes adminUserId: "admin" and
// writes no AuditLog row at all.

let app: FastifyInstance;
let prisma: PrismaClient;

const suffix = randomUUID().slice(0, 8);
const programId = `prog_m0a_${suffix}`;

let adminId = "";
let adminCookie = "";
let memberId = "";

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  prisma = (await import("../db.js")).prisma;

  await prisma.program.create({ data: { id: programId, name: `M0A ${suffix}` } });

  const email = `m0a-admin-${suffix}@loyaltyos.dev`;
  const password = `pw-${suffix}`;
  const admin = await prisma.adminUser.create({
    data: {
      email,
      name: "M0A Admin",
      passwordHash: await hashPassword(password),
      role: "SUPER_ADMIN",
      programId,
    },
  });
  adminId = admin.id;

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/login",
    payload: { email, password },
  });
  const c = login.cookies.find((x) => x.name === "loyaltyos_admin_session");
  adminCookie = `${c?.name}=${c?.value}`;

  const member = await prisma.member.create({
    data: { email: `m0a-member-${suffix}@loyaltyos.dev`, programId },
  });
  memberId = member.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { programId } }).catch(() => {});
  await prisma.pointTransaction.deleteMany({ where: { account: { memberId } } }).catch(() => {});
  await prisma.pointAccount.deleteMany({ where: { memberId } }).catch(() => {});
  await prisma.member.deleteMany({ where: { programId } }).catch(() => {});
  const admin = await prisma.adminUser.findUnique({
    where: { email: `m0a-admin-${suffix}@loyaltyos.dev` },
  });
  if (admin) {
    await prisma.adminSession.deleteMany({ where: { userId: admin.id } }).catch(() => {});
    await prisma.adminUser.delete({ where: { id: admin.id } }).catch(() => {});
  }
  await prisma.program.delete({ where: { id: programId } }).catch(() => {});
  await app.close();
});

describe("M0 adjust — real actor in the audit log", () => {
  it('records the real admin (not "admin") as the adjust actor', async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/members/${memberId}/adjust`,
      headers: { cookie: adminCookie, "idempotency-key": `m0a-adj-${suffix}` },
      payload: { amount: 10, reason: "test" },
    });
    expect(res.statusCode).toBe(201);

    const row = await prisma.auditLog.findFirst({
      where: { programId, action: "ADJUST_POINTS" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.actorType).toBe("ADMIN_USER");
    expect(row!.actorId).toBe(adminId);
    expect(row!.adminUserId).toBe(adminId);
    expect(row!.actorId).not.toBe("admin");
  });
});

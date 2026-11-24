// Points-expiry behaviour against a real PostgreSQL database (PR B).
// Runs only when TEST_DATABASE_URL is set (migrated LoyaltyOS schema).
import type { ExpiryMode } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addMonths } from "../expiry.js";
import { PointsService } from "../service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("PointsService expiry modes (PostgreSQL)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function ensureOrg(): Promise<string> {
    await prisma.organization.upsert({
      where: { id: "org_default" },
      update: {},
      create: { id: "org_default", name: "Default" },
    });
    return "org_default";
  }

  async function newMember(options: { expiryMode?: ExpiryMode; expiryMonths?: number } = {}) {
    const organizationId = await ensureOrg();
    const program = await prisma.program.create({
      data: {
        name: `expiry-${String(Date.now())}-${String(Math.random())}`,
        holdDays: 0,
        expiryMode: options.expiryMode ?? "NONE",
        expiryMonths: options.expiryMonths ?? 12,
        organizationId,
      },
    });
    const member = await prisma.member.create({ data: { programId: program.id, organizationId } });
    return { programId: program.id, memberId: member.id, organizationId };
  }

  const earn = (
    svc: PointsService,
    ids: { memberId: string; programId: string },
    amount: number,
    key: string,
  ) => svc.earn({ ...ids, amount, source: "test", idempotencyKey: key });
  const redeem = (
    svc: PointsService,
    ids: { memberId: string; programId: string },
    amount: number,
    key: string,
  ) => svc.redeem({ ...ids, amount, source: "test", idempotencyKey: key });

  async function accountOf(ids: { memberId: string; programId: string }) {
    return prisma.pointAccount.findFirstOrThrow({ where: ids });
  }

  it("PER_LOT: a lot gets expiresAt = availableAt + expiryMonths and expires once", async () => {
    const ids = await newMember({ expiryMode: "PER_LOT", expiryMonths: 3 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    const lot = await prisma.pointLot.findFirstOrThrow({ where: { accountId: account.id } });
    expect(lot.expiresAt).not.toBeNull();
    expect(Math.abs(lot.expiresAt!.getTime() - addMonths(new Date(), 3).getTime())).toBeLessThan(
      60_000,
    );

    // Force the lot to already be expired, then run the job (idempotently).
    const past = new Date(Date.now() - DAY_MS);
    await prisma.pointLot.update({ where: { id: lot.id }, data: { expiresAt: past } });

    expect(await svc.expire(ids.programId)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
    expect(await svc.expire(ids.programId)).toBe(0);
  });

  it("PER_LOT: redeem consumes the lot expiring sooner first", async () => {
    const ids = await newMember({ expiryMode: "PER_LOT", expiryMonths: 12 });
    const svc = new PointsService(prisma);
    const e1 = await earn(svc, ids, 100, `a-${ids.memberId}`);
    const e2 = await earn(svc, ids, 100, `b-${ids.memberId}`);

    const lotA = await prisma.pointLot.findFirstOrThrow({
      where: { sourceTxId: e1.transactionId },
    });
    const lotB = await prisma.pointLot.findFirstOrThrow({
      where: { sourceTxId: e2.transactionId },
    });
    await prisma.pointLot.update({
      where: { id: lotA.id },
      data: { expiresAt: addMonths(new Date(), 1) },
    });

    await redeem(svc, ids, 100, `r-${ids.memberId}`);

    expect((await prisma.pointLot.findUniqueOrThrow({ where: { id: lotA.id } })).remaining).toBe(0);
    expect((await prisma.pointLot.findUniqueOrThrow({ where: { id: lotB.id } })).remaining).toBe(
      100,
    );
  });

  it("INACTIVITY: anchor falls back to expiryChangedAt when there is no activity", async () => {
    const ids = await newMember({ expiryMode: "INACTIVITY", expiryMonths: 12 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    await prisma.pointAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: null },
    });

    const bal = await svc.balance(ids.memberId, ids.programId);
    expect(bal.nextExpiry).toEqual({
      amount: 100,
      date: addMonths(
        (await prisma.program.findUniqueOrThrow({ where: { id: ids.programId } })).expiryChangedAt,
        12,
      ),
      mode: "INACTIVITY",
    });
  });

  it("INACTIVITY: a member inactive 2 years loses nothing on activation day", async () => {
    const ids = await newMember({ expiryMode: "NONE" });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    const twoYearsAgo = new Date(Date.now() - 730 * DAY_MS);
    await prisma.pointAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: twoYearsAgo },
    });

    const now = new Date();
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryMode: "INACTIVITY", expiryMonths: 12, expiryChangedAt: now },
    });

    // Nothing expires the day it is activated…
    expect(await svc.expire(ids.programId, now)).toBe(0);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(100);

    // …and expires expiryMonths later.
    expect(await svc.expire(ids.programId, addMonths(now, 12))).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
  });

  it("INACTIVITY: two parallel expiry jobs create a single EXPIRE", async () => {
    const ids = await newMember({ expiryMode: "INACTIVITY", expiryMonths: 12 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    await prisma.pointAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: null },
    });
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryChangedAt: new Date(Date.now() - 400 * DAY_MS) },
    });

    const now = new Date();
    const [a, b] = await Promise.all([
      svc.expire(ids.programId, now),
      svc.expire(ids.programId, now),
    ]);

    expect(a + b).toBe(1);
    expect(
      await prisma.pointTransaction.count({ where: { programId: ids.programId, type: "EXPIRE" } }),
    ).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
  });

  it("NONE: points never expire", async () => {
    const ids = await newMember({ expiryMode: "NONE" });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const farFuture = new Date(Date.now() + 10 * 365 * DAY_MS);
    expect(await svc.expire(ids.programId, farFuture)).toBe(0);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(100);
    expect((await svc.balance(ids.memberId, ids.programId)).nextExpiry).toBeNull();
  });

  it("INACTIVITY: a failing account does not block the others from expiring", async () => {
    const ids = await newMember({ expiryMode: "INACTIVITY", expiryMonths: 12 });
    const other = await prisma.member.create({
      data: { programId: ids.programId, organizationId: ids.organizationId },
    });
    const otherIds = { memberId: other.id, programId: ids.programId };
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-a-${ids.memberId}`);
    await earn(svc, otherIds, 100, `seed-b-${other.id}`);

    const accountA = await accountOf(ids);
    const accountB = await accountOf(otherIds);
    const past = new Date(Date.now() - 400 * DAY_MS);
    await prisma.pointAccount.update({
      where: { id: accountA.id },
      data: { lastActivityAt: null },
    });
    await prisma.pointAccount.update({
      where: { id: accountB.id },
      data: { lastActivityAt: null },
    });
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryChangedAt: past },
    });

    // Force account A's expiry to collide on its idempotency key so its
    // transaction aborts; account B must still expire.
    const now = new Date();
    const collidingKey = `expire-inactive-${accountA.id}-${now.toISOString().slice(0, 10)}`;
    await prisma.pointTransaction.create({
      data: {
        accountId: accountA.id,
        programId: ids.programId,
        type: "EARN",
        amount: 1,
        balanceAfter: 0,
        source: "test:collision",
        idempotencyKey: collidingKey,
        settledAt: now,
      },
    });

    expect(await svc.expire(ids.programId, now)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(100);
    expect((await svc.balance(other.id, ids.programId)).confirmed).toBe(0);
  });

  it("INACTIVITY: a positive adjustment after expiry expires on a later run without error", async () => {
    const ids = await newMember({ expiryMode: "INACTIVITY", expiryMonths: 12 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    await prisma.pointAccount.update({
      where: { id: account.id },
      data: { lastActivityAt: null },
    });
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryChangedAt: new Date(Date.now() - 400 * DAY_MS) },
    });

    const now1 = new Date();
    expect(await svc.expire(ids.programId, now1)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);

    // A positive adjustment is not activity: it adds spendable points without
    // touching lastActivityAt, so the account still qualifies as inactive.
    await svc.adjust({
      memberId: ids.memberId,
      programId: ids.programId,
      amount: 50,
      reason: "goodwill credit",
      adminUserId: "admin-1",
      idempotencyKey: `adj-${ids.memberId}`,
    });
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(50);

    const now2 = new Date(now1.getTime() + 2 * DAY_MS);
    expect(await svc.expire(ids.programId, now2)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
    expect(
      await prisma.pointTransaction.count({ where: { programId: ids.programId, type: "EXPIRE" } }),
    ).toBe(2);
  });

  it("PER_LOT: backfills an expiry on lots missing one before expiring them", async () => {
    const ids = await newMember({ expiryMode: "PER_LOT", expiryMonths: 3 });
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const account = await accountOf(ids);
    const lot = await prisma.pointLot.findFirstOrThrow({ where: { accountId: account.id } });
    const past = new Date(Date.now() - 400 * DAY_MS);

    // Simulate a lot created while the mode was switching: no expiry, backdated
    // createdAt so max(createdAt, expiryChangedAt) + months lands in the past.
    await prisma.pointLot.update({
      where: { id: lot.id },
      data: { expiresAt: null, createdAt: past },
    });
    await prisma.program.update({
      where: { id: ids.programId },
      data: { expiryChangedAt: past },
    });

    expect(await svc.expire(ids.programId)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
  });
});

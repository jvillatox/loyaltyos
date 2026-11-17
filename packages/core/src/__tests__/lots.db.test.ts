// Point-lot behaviour against a real PostgreSQL database (PR A groundwork).
// Runs only when TEST_DATABASE_URL is set (migrated LoyaltyOS schema).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyConsistency } from "../ledger.js";
import { PointsService } from "../service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("PointLot behaviour (PostgreSQL)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newMember(holdDays = 0) {
    const program = await prisma.program.create({
      data: { name: `lots-${String(Date.now())}-${String(Math.random())}`, holdDays },
    });
    const member = await prisma.member.create({ data: { programId: program.id } });
    return { programId: program.id, memberId: member.id };
  }

  async function newAdmin(programId: string) {
    return prisma.adminUser.create({
      data: {
        email: `lots-admin-${String(Date.now())}-${String(Math.random())}@loyaltyos.test`,
        name: "Test Admin",
        passwordHash: "test",
        programId,
      },
    });
  }

  async function state(memberId: string, programId: string) {
    const account = await prisma.pointAccount.findFirstOrThrow({ where: { memberId, programId } });
    const lots = await prisma.pointLot.findMany({ where: { accountId: account.id } });
    const totalRemaining = lots.reduce((sum, lot) => sum + lot.remaining, 0);
    return { account, lots, totalRemaining, balance: account.balance, debt: account.debt };
  }

  async function expectInvariant(memberId: string, programId: string) {
    const s = await state(memberId, programId);
    expect(s.balance).toBe(s.totalRemaining - s.debt);
    if (s.debt > 0) expect(s.totalRemaining).toBe(0);
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
  const adjust = (
    svc: PointsService,
    ids: { memberId: string; programId: string },
    amount: number,
    adminUserId: string,
    key: string,
  ) => svc.adjust({ ...ids, amount, reason: "test", adminUserId, idempotencyKey: key });

  it("immediate earn creates a lot; held earn defers it to settlement", async () => {
    const immediate = await newMember(0);
    const held = await newMember(3);
    const svc = new PointsService(prisma);

    const earned = await earn(svc, immediate, 100, `im-${immediate.memberId}`);
    let s = await state(immediate.memberId, immediate.programId);
    expect(s.lots).toHaveLength(1);
    expect(s.lots[0]!.remaining).toBe(100);
    expect(s.lots[0]!.sourceTxId).toBe(earned.transactionId);
    expect(s.lots[0]!.expiresAt).toBeNull();
    await expectInvariant(immediate.memberId, immediate.programId);

    await earn(svc, held, 100, `h-${held.memberId}`);
    s = await state(held.memberId, held.programId);
    expect(s.lots).toHaveLength(0);
    expect(s.account.pendingBalance).toBe(100);

    await svc.settlePending(held.programId, new Date(Date.now() + 4 * DAY_MS));
    s = await state(held.memberId, held.programId);
    expect(s.lots).toHaveLength(1);
    expect(s.lots[0]!.remaining).toBe(100);
    await expectInvariant(held.memberId, held.programId);
  });

  it("redeem consumes lots FIFO (oldest first)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    const e1 = await earn(svc, ids, 100, `a-${ids.memberId}`);
    const e2 = await earn(svc, ids, 100, `b-${ids.memberId}`);

    await redeem(svc, ids, 150, `r-${ids.memberId}`);

    const lotA = await prisma.pointLot.findFirstOrThrow({
      where: { sourceTxId: e1.transactionId },
    });
    const lotB = await prisma.pointLot.findFirstOrThrow({
      where: { sourceTxId: e2.transactionId },
    });
    expect(lotA.remaining).toBe(0);
    expect(lotB.remaining).toBe(50);
    await expectInvariant(ids.memberId, ids.programId);
  });

  it("positive adjustment creates a lot; negative adjustment consumes and may create debt", async () => {
    const ids = await newMember();
    const admin = await newAdmin(ids.programId);
    const svc = new PointsService(prisma);

    await adjust(svc, ids, 100, admin.id, `pos-${ids.memberId}`);
    let s = await state(ids.memberId, ids.programId);
    expect(s.lots).toHaveLength(1);
    expect(s.lots[0]!.remaining).toBe(100);

    await adjust(svc, ids, -150, admin.id, `neg-${ids.memberId}`);
    s = await state(ids.memberId, ids.programId);
    expect(s.balance).toBe(-50);
    expect(s.debt).toBe(50);
    expect(s.totalRemaining).toBe(0);
    await expectInvariant(ids.memberId, ids.programId);
  });

  it("reverse of a settled EARN consumes own lot, then others FIFO, then debt", async () => {
    const ids = await newMember();
    const admin = await newAdmin(ids.programId);
    const svc = new PointsService(prisma);
    const e1 = await earn(svc, ids, 100, `a-${ids.memberId}`);
    await earn(svc, ids, 100, `b-${ids.memberId}`);
    await redeem(svc, ids, 150, `r-${ids.memberId}`);

    await svc.reverse(ids.programId, e1.transactionId, "refund", admin.id);

    const s = await state(ids.memberId, ids.programId);
    expect(s.balance).toBe(-50);
    expect(s.debt).toBe(50);
    expect(s.totalRemaining).toBe(0);
    await expectInvariant(ids.memberId, ids.programId);
  });

  it("reverse of an unsettled EARN only touches the pending balance", async () => {
    const ids = await newMember(3);
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `h-${ids.memberId}`);

    await svc.reverse(ids.programId, earned.transactionId, "refund", "admin-1");

    const s = await state(ids.memberId, ids.programId);
    expect(s.account.pendingBalance).toBe(0);
    expect(s.balance).toBe(0);
    expect(s.lots).toHaveLength(0);
    expect(s.debt).toBe(0);
  });

  it("a credit repays debt before creating a lot", async () => {
    const ids = await newMember();
    const admin = await newAdmin(ids.programId);
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `a-${ids.memberId}`);
    await redeem(svc, ids, 100, `r-${ids.memberId}`);
    await svc.reverse(ids.programId, earned.transactionId, "refund", admin.id);

    await earn(svc, ids, 40, `cover1-${ids.memberId}`);
    let s = await state(ids.memberId, ids.programId);
    expect(s.debt).toBe(60);
    expect(s.totalRemaining).toBe(0);

    await earn(svc, ids, 80, `cover2-${ids.memberId}`);
    s = await state(ids.memberId, ids.programId);
    expect(s.balance).toBe(20);
    expect(s.debt).toBe(0);
    expect(s.totalRemaining).toBe(20);
    await expectInvariant(ids.memberId, ids.programId);
  });

  it("verifyConsistency flags lot and debt mismatches", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `a-${ids.memberId}`);

    const account = await prisma.pointAccount.findFirstOrThrow({ where: ids });
    const txs = await prisma.pointTransaction.findMany({ where: { accountId: account.id } });
    const lots = await prisma.pointLot.findMany({ where: { accountId: account.id } });

    const valid = verifyConsistency({
      transactions: txs,
      balance: account.balance,
      pendingBalance: account.pendingBalance,
      lots,
      debt: account.debt,
    });
    expect(valid.valid).toBe(true);

    const tampered = verifyConsistency({
      transactions: txs,
      balance: account.balance + 5,
      pendingBalance: account.pendingBalance,
      lots,
      debt: account.debt,
    });
    expect(tampered.valid).toBe(false);
    expect(tampered.errors.some((e) => e.startsWith("Lot invariant mismatch"))).toBe(true);

    const coexisting = verifyConsistency({
      transactions: txs,
      balance: account.balance,
      pendingBalance: account.pendingBalance,
      lots: [{ remaining: 10 }],
      debt: 100,
    });
    expect(coexisting.errors.some((e) => e.startsWith("Debt invariant mismatch"))).toBe(true);
  });

  it("serializes concurrent redeems across 20 consecutive runs", async () => {
    const svc = new PointsService(prisma);
    for (let i = 0; i < 20; i++) {
      const ids = await newMember();
      await earn(svc, ids, 100, `seed-${String(i)}-${ids.memberId}`);

      const results = await Promise.allSettled([
        redeem(svc, ids, 100, `r1-${String(i)}-${ids.memberId}`),
        redeem(svc, ids, 100, `r2-${String(i)}-${ids.memberId}`),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const s = await state(ids.memberId, ids.programId);
      expect(s.balance).toBe(0);
      expect(s.totalRemaining).toBe(0);
    }
  });

  it("rejects rows that violate PointLot and debt CHECK constraints", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `c-${ids.memberId}`);
    const account = await prisma.pointAccount.findFirstOrThrow({ where: ids });

    const badLot = (originalAmount: number, remaining: number) =>
      prisma.pointLot.create({
        data: { accountId: account.id, programId: ids.programId, originalAmount, remaining },
      });

    await expect(badLot(10, -1)).rejects.toThrow(); // remaining >= 0
    await expect(badLot(10, 11)).rejects.toThrow(); // remaining <= originalAmount
    await expect(badLot(0, 0)).rejects.toThrow(); // originalAmount > 0

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "PointAccount" SET "debt" = -1 WHERE "id" = '${account.id}'`,
      ),
    ).rejects.toThrow(); // debt >= 0
  });
});

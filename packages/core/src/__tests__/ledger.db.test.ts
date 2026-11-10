// Ledger behaviour against a real PostgreSQL database.
// Runs only when TEST_DATABASE_URL is set (migrated LoyaltyOS schema), e.g.
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5433/loyaltyos_test pnpm --filter @loyaltyos/core test
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyConsistency } from "../ledger.js";
import { PointsService } from "../service.js";
import {
  AlreadyReversedError,
  CannotReverseError,
  InsufficientBalanceError,
  TransactionNotFoundError,
} from "../types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const HOLD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function rejectionOf(results: PromiseSettledResult<unknown>[]): unknown {
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  return rejected?.reason;
}

describe.skipIf(!databaseUrl)("PointsService ledger (PostgreSQL)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newMember() {
    const program = await prisma.program.create({
      data: { name: `test-${String(Date.now())}-${String(Math.random())}` },
    });
    const member = await prisma.member.create({ data: { programId: program.id } });
    return { programId: program.id, memberId: member.id };
  }

  async function newAdmin(programId: string) {
    return prisma.adminUser.create({
      data: {
        email: `admin-${String(Date.now())}-${String(Math.random())}@loyaltyos.test`,
        name: "Test Admin",
        passwordHash: "test",
        programId,
      },
    });
  }

  async function ledgerIsConsistent(memberId: string, programId: string) {
    const account = await prisma.pointAccount.findFirstOrThrow({ where: { memberId, programId } });
    const txs = await prisma.pointTransaction.findMany({
      where: { accountId: account.id, settledAt: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    const sum = txs.reduce((total, tx) => {
      const sign = ["EARN", "CONVERT_IN", "ADJUST"].includes(tx.type) ? 1 : -1;
      return total + sign * tx.amount;
    }, 0);
    return { balance: account.balance, sum };
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

  it("allows only one of two concurrent redemptions of the full balance (F1)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const results = await Promise.allSettled([
      redeem(svc, ids, 100, `r1-${ids.memberId}`),
      redeem(svc, ids, 100, `r2-${ids.memberId}`),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejectionOf(results)).toBeInstanceOf(InsufficientBalanceError);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
  });

  it("keeps every concurrent earn (F2)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => earn(svc, ids, 50, `e${String(i)}-${ids.memberId}`)),
    );

    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(500);
    const { balance, sum } = await ledgerIsConsistent(ids.memberId, ids.programId);
    expect(balance).toBe(sum);
  });

  it("records each balanceAfter in commit order so the ledger verifies", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => earn(svc, ids, 10 + i, `o${String(i)}-${ids.memberId}`)),
    );

    const account = await prisma.pointAccount.findFirstOrThrow({ where: ids });
    const txs = await prisma.pointTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { balanceAfter: "asc" },
    });
    expect(verifyConsistency(txs).valid).toBe(true);
  });

  it("returns the original result for a concurrent duplicate idempotency key", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    const key = `dup-${ids.memberId}`;

    const [a, b] = await Promise.all([earn(svc, ids, 70, key), earn(svc, ids, 70, key)]);

    expect(a.transactionId).toBe(b.transactionId);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(70);
  });

  it("reverses an earn by removing the points (F3)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const result = await svc.reverse(ids.programId, earned.transactionId, "refund", "admin-1");

    expect(result.amountReversed).toBe(100);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
  });

  it("reverses a redemption by returning the points (F3)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    await earn(svc, ids, 100, `seed-${ids.memberId}`);
    const spent = await redeem(svc, ids, 40, `spend-${ids.memberId}`);

    await svc.reverse(ids.programId, spent.transactionId, "purchase voided", "admin-1");

    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(100);
  });

  it("rejects a second reversal of the same transaction, even concurrently (F5)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const results = await Promise.allSettled([
      svc.reverse(ids.programId, earned.transactionId, "refund", "admin-1"),
      svc.reverse(ids.programId, earned.transactionId, "refund", "admin-2"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejectionOf(results)).toBeInstanceOf(AlreadyReversedError);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
  });

  it("does not let one program reverse another program's transaction (#37)", async () => {
    const a = await newMember();
    const b = await newMember();
    const svc = new PointsService(prisma);
    const earned = await earn(svc, a, 100, `seed-${a.memberId}`);

    await expect(
      svc.reverse(b.programId, earned.transactionId, "refund", "admin-1"),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);

    // Program A's points are untouched.
    expect((await svc.balance(a.memberId, a.programId)).confirmed).toBe(100);
  });

  it("allows a reversal to take the balance negative and records the actor and reason (#36)", async () => {
    const ids = await newMember();
    const admin = await newAdmin(ids.programId);
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `seed-${ids.memberId}`);
    await redeem(svc, ids, 100, `spend-${ids.memberId}`);

    const result = await svc.reverse(
      ids.programId,
      earned.transactionId,
      "earn refunded",
      admin.id,
    );

    expect(result.amountReversed).toBe(100);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(-100);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: {
        programId: ids.programId,
        action: "REVERSE_TRANSACTION",
        entityId: earned.transactionId,
      },
    });
    expect(row.actorType).toBe("ADMIN_USER");
    expect(row.actorId).toBe(admin.id);
    expect(row.adminUserId).toBe(admin.id);
    expect(row.reason).toBe("earn refunded");
    expect((row.metadata as { balanceAfter: number }).balanceAfter).toBe(-100);
  });

  it("blocks redemption while negative and covers the debt with later earnings (#36)", async () => {
    const ids = await newMember();
    const admin = await newAdmin(ids.programId);
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `seed-${ids.memberId}`);
    await redeem(svc, ids, 100, `spend-${ids.memberId}`);
    await svc.reverse(ids.programId, earned.transactionId, "earn refunded", admin.id);

    await expect(redeem(svc, ids, 1, `again-${ids.memberId}`)).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );

    await earn(svc, ids, 40, `cover-1-${ids.memberId}`);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(-60);

    await earn(svc, ids, 80, `cover-2-${ids.memberId}`);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(20);
  });

  it("rejects reversing a REVERSE transaction (#36)", async () => {
    const ids = await newMember();
    const admin = await newAdmin(ids.programId);
    const svc = new PointsService(prisma);
    const earned = await earn(svc, ids, 100, `seed-${ids.memberId}`);

    const reversal = await svc.reverse(ids.programId, earned.transactionId, "refund", admin.id);

    await expect(
      svc.reverse(ids.programId, reversal.reversalId, "double refund", admin.id),
    ).rejects.toBeInstanceOf(CannotReverseError);
  });

  describe("with a hold period (F4)", () => {
    it("keeps new points pending and not spendable", async () => {
      const ids = await newMember();
      const svc = new PointsService(prisma, undefined, { holdDays: HOLD_DAYS });
      await earn(svc, ids, 100, `seed-${ids.memberId}`);

      expect(await svc.balance(ids.memberId, ids.programId)).toEqual({
        confirmed: 0,
        pending: 100,
        total: 100,
      });
      await expect(redeem(svc, ids, 1, `spend-${ids.memberId}`)).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );
    });

    it("settles pending points once the hold has passed", async () => {
      const ids = await newMember();
      const svc = new PointsService(prisma, undefined, { holdDays: HOLD_DAYS });
      await earn(svc, ids, 100, `seed-${ids.memberId}`);

      const settledEarly = await svc.settlePending(ids.programId, new Date());
      expect(settledEarly).toBe(0);

      const settled = await svc.settlePending(
        ids.programId,
        new Date(Date.now() + (HOLD_DAYS + 1) * DAY_MS),
      );
      expect(settled).toBe(1);
      expect(await svc.balance(ids.memberId, ids.programId)).toEqual({
        confirmed: 100,
        pending: 0,
        total: 100,
      });

      const again = await svc.settlePending(
        ids.programId,
        new Date(Date.now() + (HOLD_DAYS + 1) * DAY_MS),
      );
      expect(again).toBe(0);
    });

    it("reverses a still-pending earn from the pending balance", async () => {
      const ids = await newMember();
      const svc = new PointsService(prisma, undefined, { holdDays: HOLD_DAYS });
      const earned = await earn(svc, ids, 100, `seed-${ids.memberId}`);

      await svc.reverse(ids.programId, earned.transactionId, "refund", "admin-1");

      expect(await svc.balance(ids.memberId, ids.programId)).toEqual({
        confirmed: 0,
        pending: 0,
        total: 0,
      });
      const settled = await svc.settlePending(
        ids.programId,
        new Date(Date.now() + (HOLD_DAYS + 1) * DAY_MS),
      );
      expect(settled).toBe(0);
    });
  });

  it("expires points once, never below zero, and can be re-run (F6)", async () => {
    const ids = await newMember();
    const svc = new PointsService(prisma);
    const past = new Date(Date.now() - DAY_MS);
    await svc.earn({
      ...ids,
      amount: 100,
      source: "test",
      idempotencyKey: `seed-${ids.memberId}`,
      expiresAt: past,
    });
    await redeem(svc, ids, 70, `spend-${ids.memberId}`);

    expect(await svc.expire(ids.programId)).toBe(1);
    expect((await svc.balance(ids.memberId, ids.programId)).confirmed).toBe(0);
    expect(await svc.expire(ids.programId)).toBe(0);
  });
});

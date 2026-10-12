import { Prisma, type PrismaClient } from "@prisma/client";

import { applyTxToBalance } from "./ledger.js";
import { createRepository } from "./repository.js";
import { calculateEffectiveAmount, evaluateRules } from "./rules.js";
import type {
  AdjustInput,
  AdjustResult,
  Balance,
  EarnInput,
  EarnResult,
  PaginatedResult,
  PaginationParams,
  RedeemInput,
  RedeemResult,
  ReverseResult,
} from "./types.js";
import {
  AlreadyReversedError,
  CannotReverseError,
  InsufficientBalanceError,
  TransactionNotFoundError,
} from "./types.js";

export interface PointsServiceMetrics {
  recordEarn(programId: string, amount: number, idempotent: boolean): void;
  recordRedeem(programId: string, amount: number): void;
  recordAdjust(programId: string, amount: number): void;
  recordReverse(programId: string, originalType: string): void;
  recordExpire(programId: string): void;
  recordInsufficientBalance(programId: string): void;
  setProgramBalance(programId: string, balance: number): void;
  setActiveMembers(programId: string, count: number): void;
}

export interface PointsServiceOptions {
  /**
   * Days before earned points become spendable. 0 (default) makes them
   * available immediately; above 0 they sit in `pendingBalance` until
   * `settlePending()` moves them.
   */
  holdDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
}

/**
 * Points ledger. Every balance change and its ledger entry are written in one
 * database transaction, using atomic increments and balance-checked updates, so
 * concurrent requests can neither overspend nor lose updates.
 */
export class PointsService {
  private prisma: PrismaClient;
  private repo: ReturnType<typeof createRepository>;
  private metrics?: PointsServiceMetrics;
  private holdDays: number;

  constructor(
    prisma: PrismaClient,
    metrics?: PointsServiceMetrics,
    options: PointsServiceOptions = {},
  ) {
    this.prisma = prisma;
    this.repo = createRepository(prisma);
    this.metrics = metrics;
    this.holdDays = options.holdDays ?? 0;
  }

  async earn(input: EarnInput): Promise<EarnResult> {
    const existing = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.idempotentEarn(input.programId, existing);

    const rules = await this.repo.findActiveRules(input.programId, "purchase");
    const evaluation = evaluateRules(rules, input.metadata);
    const effective = calculateEffectiveAmount(input.amount, evaluation.multiplier);
    const held = this.holdDays > 0;

    const account = await this.ensureAccount(input.memberId, input.programId);
    try {
      const { tx, balanceAfter } = await this.prisma.$transaction(async (db) => {
        const updated = await db.pointAccount.update({
          where: { id: account.id },
          data: held
            ? {
                pendingBalance: { increment: effective.total },
                totalEarned: { increment: effective.total },
              }
            : {
                balance: { increment: effective.total },
                totalEarned: { increment: effective.total },
              },
        });
        const created = await db.pointTransaction.create({
          data: {
            accountId: account.id,
            type: "EARN",
            amount: effective.total,
            balanceAfter: updated.balance,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            expiresAt: input.expiresAt,
            settledAt: held ? null : new Date(),
          },
        });
        return { tx: created, balanceAfter: updated.balance };
      });

      this.metrics?.recordEarn(input.programId, effective.total, false);
      this.metrics?.setProgramBalance(input.programId, balanceAfter);
      return {
        transactionId: tx.id,
        amount: effective.total,
        multiplier: evaluation.multiplier,
        balanceAfter,
        idempotent: false,
      };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
      if (!winner) throw err;
      return this.idempotentEarn(input.programId, winner);
    }
  }

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    const existing = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.idempotentResult(existing);

    try {
      const { tx, balanceAfter } = await this.prisma.$transaction(async (db) => {
        const account = await db.pointAccount.findFirst({
          where: { memberId: input.memberId, programId: input.programId },
        });
        if (!account) throw new InsufficientBalanceError(0, input.amount);

        // Balance-checked decrement: PostgreSQL re-checks the condition after
        // acquiring the row lock, so concurrent redemptions cannot overspend.
        const debited = await db.pointAccount.updateMany({
          where: { id: account.id, balance: { gte: input.amount } },
          data: {
            balance: { decrement: input.amount },
            totalRedeemed: { increment: input.amount },
          },
        });
        if (debited.count === 0) {
          const current = await db.pointAccount.findUniqueOrThrow({ where: { id: account.id } });
          throw new InsufficientBalanceError(current.balance, input.amount);
        }

        const updated = await db.pointAccount.findUniqueOrThrow({ where: { id: account.id } });
        const created = await db.pointTransaction.create({
          data: {
            accountId: account.id,
            type: "REDEEM",
            amount: input.amount,
            balanceAfter: updated.balance,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            settledAt: new Date(),
          },
        });
        return { tx: created, balanceAfter: updated.balance };
      });

      this.metrics?.recordRedeem(input.programId, input.amount);
      this.metrics?.setProgramBalance(input.programId, balanceAfter);
      return { transactionId: tx.id, amount: input.amount, balanceAfter, idempotent: false };
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        this.metrics?.recordInsufficientBalance(input.programId);
        throw err;
      }
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
      if (!winner) throw err;
      return this.idempotentResult(winner);
    }
  }

  async adjust(input: AdjustInput): Promise<AdjustResult> {
    const existing = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.id,
        amount: existing.amount,
        balanceAfter: existing.balanceAfter,
      };
    }

    const account = await this.ensureAccount(input.memberId, input.programId);
    try {
      const { tx, balanceAfter } = await this.prisma.$transaction(async (db) => {
        const updated = await db.pointAccount.update({
          where: { id: account.id },
          data: { balance: { increment: input.amount } },
        });
        const created = await db.pointTransaction.create({
          data: {
            accountId: account.id,
            type: "ADJUST",
            amount: input.amount,
            balanceAfter: updated.balance,
            source: `admin:${input.adminUserId}`,
            idempotencyKey: input.idempotencyKey,
            description: input.reason,
            settledAt: new Date(),
          },
        });
        return { tx: created, balanceAfter: updated.balance };
      });

      this.metrics?.recordAdjust(input.programId, input.amount);
      this.metrics?.setProgramBalance(input.programId, balanceAfter);
      return { transactionId: tx.id, amount: input.amount, balanceAfter };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
      if (!winner) throw err;
      return { transactionId: winner.id, amount: winner.amount, balanceAfter: winner.balanceAfter };
    }
  }

  /**
   * Undoes a transaction: an EARN removes the points (from pending if not yet
   * settled), a REDEEM or EXPIRE returns them. The REVERSE entry stores the
   * original's signed effect, so `applyTxToBalance("REVERSE", amount)` undoes it.
   * Reversing EARN points that were already spent can take the balance negative.
   */
  async reverse(
    txId: string,
    reason: string,
    adminUserId: string,
    idempotencyKey?: string,
  ): Promise<ReverseResult> {
    const key = idempotencyKey ?? `reverse-${txId}-${adminUserId}`;

    const existing = await this.repo.findTxByIdempotencyKey(key);
    if (existing) {
      const original = await this.repo.findTxById(txId);
      if (!original) throw new TransactionNotFoundError(txId);
      return {
        reversalId: existing.id,
        originalType: original.type,
        amountReversed: Math.abs(existing.amount),
      };
    }

    const original = await this.repo.findTxById(txId);
    if (!original) throw new TransactionNotFoundError(txId);
    if (original.type === "REVERSE") throw new CannotReverseError(txId);

    const effect = applyTxToBalance(original.type, original.amount);

    const { reversal, programId } = await this.prisma.$transaction(async (db) => {
      // Claim the original first; a concurrent reversal blocks on this row and
      // then finds it already claimed.
      const claimed = await db.pointTransaction.updateMany({
        where: { id: txId, reversedById: null },
        data: { reversedById: key },
      });
      if (claimed.count === 0) throw new AlreadyReversedError(txId);

      // Read settlement state under the claim: settlePending() skips claimed
      // rows, so this cannot change before commit.
      const current = await db.pointTransaction.findUniqueOrThrow({ where: { id: txId } });
      const fromPending = current.type === "EARN" && current.settledAt === null;

      const updated = await db.pointAccount.update({
        where: { id: original.accountId },
        data: fromPending
          ? { pendingBalance: { increment: -effect } }
          : { balance: { increment: -effect } },
      });
      const created = await db.pointTransaction.create({
        data: {
          accountId: original.accountId,
          type: "REVERSE",
          amount: effect,
          balanceAfter: updated.balance,
          source: `admin:${adminUserId}`,
          idempotencyKey: key,
          description: reason,
          reversedFromId: txId,
          settledAt: fromPending ? null : new Date(),
        },
      });
      await db.pointTransaction.update({ where: { id: txId }, data: { reversedById: created.id } });
      return { reversal: created, programId: updated.programId };
    });

    this.metrics?.recordReverse(programId, original.type);
    return {
      reversalId: reversal.id,
      originalType: original.type,
      amountReversed: Math.abs(effect),
    };
  }

  /** Moves held EARN points to the spendable balance once the hold has passed. Safe to re-run. */
  async settlePending(programId: string, now: Date = new Date()): Promise<number> {
    if (this.holdDays === 0) return 0;
    const cutoff = new Date(now.getTime() - this.holdDays * DAY_MS);
    const due = await this.prisma.pointTransaction.findMany({
      where: {
        account: { programId },
        type: "EARN",
        settledAt: null,
        reversedById: null,
        createdAt: { lte: cutoff },
      },
      select: { id: true, accountId: true, amount: true },
    });

    let settled = 0;
    for (const tx of due) {
      const moved = await this.prisma.$transaction(async (db) => {
        const claimed = await db.pointTransaction.updateMany({
          where: { id: tx.id, settledAt: null, reversedById: null },
          data: { settledAt: now },
        });
        if (claimed.count === 0) return false;
        await db.pointAccount.update({
          where: { id: tx.accountId },
          data: { pendingBalance: { decrement: tx.amount }, balance: { increment: tx.amount } },
        });
        return true;
      });
      if (moved) settled++;
    }
    return settled;
  }

  /**
   * Expires EARN transactions past `expiresAt`. Removes at most the current
   * spendable balance (never below zero) and marks the EARN so re-runs skip it.
   */
  async expire(programId: string): Promise<number> {
    const due = await this.repo.findExpiredTransactions(programId, new Date());

    let expiredCount = 0;
    for (const tx of due) {
      if (tx.settledAt === null) continue;
      const key = `expire-${tx.id}`;
      const expired = await this.prisma.$transaction(async (db) => {
        const claimed = await db.pointTransaction.updateMany({
          where: { id: tx.id, reversedById: null },
          data: { reversedById: key },
        });
        if (claimed.count === 0) return false;

        // Touch the row to take its lock before reading the balance, so a
        // concurrent redemption cannot spend between the read and the decrement.
        const account = await db.pointAccount.update({
          where: { id: tx.accountId },
          data: { updatedAt: new Date() },
        });
        const amount = Math.min(tx.amount, Math.max(account.balance, 0));
        const updated = await db.pointAccount.update({
          where: { id: tx.accountId },
          data: { balance: { decrement: amount } },
        });
        const created = await db.pointTransaction.create({
          data: {
            accountId: tx.accountId,
            type: "EXPIRE",
            amount,
            balanceAfter: updated.balance,
            source: "system:expire",
            idempotencyKey: key,
            description: `Expired from tx ${tx.id}`,
            reversedFromId: tx.id,
            settledAt: new Date(),
          },
        });
        await db.pointTransaction.update({
          where: { id: tx.id },
          data: { reversedById: created.id },
        });
        return true;
      });
      if (expired) {
        this.metrics?.recordExpire(programId);
        expiredCount++;
      }
    }
    return expiredCount;
  }

  async balance(memberId: string, programId: string): Promise<Balance> {
    const account = await this.repo.findAccount(memberId, programId);
    if (!account) {
      return { confirmed: 0, pending: 0, total: 0 };
    }
    return {
      confirmed: account.balance,
      pending: account.pendingBalance,
      total: account.balance + account.pendingBalance,
    };
  }

  async history(
    memberId: string,
    programId: string,
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<unknown>> {
    const account = await this.repo.findAccount(memberId, programId);
    if (!account) {
      return {
        items: [],
        total: 0,
        page: pagination.page ?? 1,
        pageSize: pagination.pageSize ?? 20,
        totalPages: 0,
      };
    }
    return this.repo.findHistory(account.id, pagination);
  }

  /**
   * Finds or creates the member's account. Runs outside the ledger transaction:
   * a unique violation would abort a PostgreSQL transaction, so a concurrent
   * first-time create is resolved here by reading the winner's row.
   */
  private async ensureAccount(memberId: string, programId: string) {
    const existing = await this.repo.findAccount(memberId, programId);
    if (existing) return existing;
    try {
      return await this.prisma.pointAccount.create({ data: { memberId, programId } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findAccount(memberId, programId);
      if (!winner) throw err;
      return winner;
    }
  }

  private idempotentEarn(
    programId: string,
    tx: { id: string; amount: number; balanceAfter: number },
  ): EarnResult {
    this.metrics?.recordEarn(programId, tx.amount, true);
    return {
      transactionId: tx.id,
      amount: tx.amount,
      multiplier: 1.0,
      balanceAfter: tx.balanceAfter,
      idempotent: true,
    };
  }

  private idempotentResult(tx: { id: string; amount: number; balanceAfter: number }): RedeemResult {
    return {
      transactionId: tx.id,
      amount: tx.amount,
      balanceAfter: tx.balanceAfter,
      idempotent: true,
    };
  }
}

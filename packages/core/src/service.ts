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
   * Fallback hold period used only when a program has no `holdDays` value.
   * The per-program `Program.holdDays` takes precedence; 0 makes earned points
   * available immediately, above 0 they sit in `pendingBalance` until
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
 *
 * Spendable points live in `PointLot` rows; the account's `balance` always equals
 * `Σ(lot.remaining) − debt`. Operations that move spendable value serialize on the
 * account row (`SELECT … FOR UPDATE`) before touching lots, so concurrent requests
 * cannot double-consume the same lot.
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
    const existing = await this.repo.findTxByIdempotencyKey(input.programId, input.idempotencyKey);
    if (existing) return this.idempotentEarn(input.programId, existing);

    const rules = await this.repo.findActiveRules(input.programId, "purchase");
    const evaluation = evaluateRules(rules, input.metadata);
    const effective = calculateEffectiveAmount(input.amount, evaluation.multiplier);
    const holdDays = await this.programHoldDays(input.programId);
    const held = holdDays > 0;
    const now = new Date();
    const availableAt = held ? new Date(now.getTime() + holdDays * DAY_MS) : null;

    const account = await this.ensureAccount(input.memberId, input.programId);
    try {
      const { tx, balanceAfter } = await this.prisma.$transaction(async (db) => {
        let updated: { balance: number };
        let lotAmount = 0;

        if (held) {
          updated = await db.pointAccount.update({
            where: { id: account.id },
            data: {
              pendingBalance: { increment: effective.total },
              totalEarned: { increment: effective.total },
              lastActivityAt: now,
            },
          });
        } else {
          const locked = await this.lockAccount(db, account.id);
          const debtAfter = Math.max(0, locked.debt - effective.total);
          lotAmount = Math.max(0, effective.total - locked.debt);
          updated = await db.pointAccount.update({
            where: { id: account.id },
            data: {
              balance: { increment: effective.total },
              totalEarned: { increment: effective.total },
              debt: debtAfter,
              lastActivityAt: now,
            },
          });
        }

        const created = await db.pointTransaction.create({
          data: {
            accountId: account.id,
            programId: input.programId,
            type: "EARN",
            amount: effective.total,
            balanceAfter: updated.balance,
            source: input.source,
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            expiresAt: input.expiresAt,
            settledAt: held ? null : now,
            availableAt,
          },
        });

        if (lotAmount > 0) {
          await db.pointLot.create({
            data: {
              accountId: account.id,
              programId: input.programId,
              sourceTxId: created.id,
              originalAmount: lotAmount,
              remaining: lotAmount,
              expiresAt: null,
            },
          });
        }

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
      const winner = await this.repo.findTxByIdempotencyKey(input.programId, input.idempotencyKey);
      if (!winner) throw err;
      return this.idempotentEarn(input.programId, winner);
    }
  }

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    const existing = await this.repo.findTxByIdempotencyKey(input.programId, input.idempotencyKey);
    if (existing) return this.idempotentResult(existing);

    try {
      const { tx, balanceAfter } = await this.prisma.$transaction(async (db) => {
        const account = await db.pointAccount.findFirst({
          where: { memberId: input.memberId, programId: input.programId },
        });
        if (!account) throw new InsufficientBalanceError(0, input.amount);

        // Serialize on the account row: a concurrent redemption blocks here and
        // re-reads the balance once the lock is released.
        const locked = await this.lockAccount(db, account.id);
        if (locked.balance < input.amount) {
          throw new InsufficientBalanceError(locked.balance, input.amount);
        }
        await this.consumeLots(db, account.id, input.amount);

        const updated = await db.pointAccount.update({
          where: { id: account.id },
          data: {
            balance: { decrement: input.amount },
            totalRedeemed: { increment: input.amount },
            lastActivityAt: new Date(),
          },
        });
        const created = await db.pointTransaction.create({
          data: {
            accountId: account.id,
            programId: input.programId,
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
      const winner = await this.repo.findTxByIdempotencyKey(input.programId, input.idempotencyKey);
      if (!winner) throw err;
      return this.idempotentResult(winner);
    }
  }

  async adjust(input: AdjustInput): Promise<AdjustResult> {
    const existing = await this.repo.findTxByIdempotencyKey(input.programId, input.idempotencyKey);
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
        const locked = await this.lockAccount(db, account.id);

        let updated: { balance: number };
        let lotAmount = 0;

        if (input.amount > 0) {
          const debtAfter = Math.max(0, locked.debt - input.amount);
          lotAmount = Math.max(0, input.amount - locked.debt);
          updated = await db.pointAccount.update({
            where: { id: account.id },
            data: { balance: { increment: input.amount }, debt: debtAfter },
          });
        } else {
          const shortfall = await this.consumeLots(db, account.id, Math.abs(input.amount));
          updated = await db.pointAccount.update({
            where: { id: account.id },
            data: { balance: { increment: input.amount }, debt: { increment: shortfall } },
          });
        }

        const created = await db.pointTransaction.create({
          data: {
            accountId: account.id,
            programId: input.programId,
            type: "ADJUST",
            amount: input.amount,
            balanceAfter: updated.balance,
            source: `admin:${input.adminUserId}`,
            idempotencyKey: input.idempotencyKey,
            description: input.reason,
            settledAt: new Date(),
          },
        });

        if (lotAmount > 0) {
          await db.pointLot.create({
            data: {
              accountId: account.id,
              programId: input.programId,
              sourceTxId: created.id,
              originalAmount: lotAmount,
              remaining: lotAmount,
              expiresAt: null,
            },
          });
        }

        return { tx: created, balanceAfter: updated.balance };
      });

      this.metrics?.recordAdjust(input.programId, input.amount);
      this.metrics?.setProgramBalance(input.programId, balanceAfter);
      return { transactionId: tx.id, amount: input.amount, balanceAfter };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.repo.findTxByIdempotencyKey(input.programId, input.idempotencyKey);
      if (!winner) throw err;
      return { transactionId: winner.id, amount: winner.amount, balanceAfter: winner.balanceAfter };
    }
  }

  /**
   * Undoes a transaction: an EARN removes the points (from pending if not yet
   * settled), a REDEEM or EXPIRE returns them. The REVERSE entry stores the
   * original's signed effect, so `applyTxToBalance("REVERSE", amount)` undoes it.
   * Reversing EARN points that were already spent consumes the EARN's own lot
   * first, then the remaining lots FIFO, and only the shortfall becomes `debt`.
   */
  async reverse(
    programId: string,
    txId: string,
    reason: string,
    adminUserId: string,
    idempotencyKey?: string,
  ): Promise<ReverseResult> {
    const key = idempotencyKey ?? `reverse-${txId}-${adminUserId}`;

    const existing = await this.repo.findTxByIdempotencyKey(programId, key);
    if (existing) {
      const original = await this.repo.findTxById(txId);
      if (!original || original.programId !== programId) {
        throw new TransactionNotFoundError(txId);
      }
      return {
        reversalId: existing.id,
        originalType: original.type,
        amountReversed: Math.abs(existing.amount),
      };
    }

    const original = await this.repo.findTxById(txId);
    if (!original || original.programId !== programId) {
      throw new TransactionNotFoundError(txId);
    }
    if (original.type === "REVERSE") throw new CannotReverseError(txId);

    const effect = applyTxToBalance(original.type, original.amount);

    const { reversal } = await this.prisma.$transaction(async (db) => {
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

      let updated: { balance: number };
      let surplusLot = 0;

      if (fromPending) {
        updated = await db.pointAccount.update({
          where: { id: original.accountId },
          data: { pendingBalance: { increment: -effect } },
        });
      } else {
        const locked = await this.lockAccount(db, original.accountId);
        if (effect > 0) {
          // Removing spendable value: consume the original's own lot first, then
          // the rest FIFO, and turn only what remains into debt.
          const shortfall = await this.consumeLots(db, original.accountId, effect, txId);
          updated = await db.pointAccount.update({
            where: { id: original.accountId },
            data: { balance: { increment: -effect }, debt: { increment: shortfall } },
          });
        } else {
          // Returning spendable value: repay debt first, surplus becomes a lot.
          const credit = -effect;
          const debtAfter = Math.max(0, locked.debt - credit);
          surplusLot = Math.max(0, credit - locked.debt);
          updated = await db.pointAccount.update({
            where: { id: original.accountId },
            data: { balance: { increment: credit }, debt: debtAfter },
          });
        }
      }

      // Reversing already-spent points is allowed and can take the balance
      // negative. Record the actor and reason so the resulting debt is auditable.
      if (!fromPending && updated.balance < 0) {
        await db.auditLog.create({
          data: {
            programId,
            actorType: "ADMIN_USER",
            actorId: adminUserId,
            adminUserId,
            action: "REVERSE_TRANSACTION",
            entityType: "point_transaction",
            entityId: txId,
            reason,
            metadata: { balanceAfter: updated.balance, amount: effect },
          },
        });
      }

      const created = await db.pointTransaction.create({
        data: {
          accountId: original.accountId,
          programId,
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

      if (surplusLot > 0) {
        await db.pointLot.create({
          data: {
            accountId: original.accountId,
            programId,
            sourceTxId: created.id,
            originalAmount: surplusLot,
            remaining: surplusLot,
            expiresAt: null,
          },
        });
      }

      return { reversal: created };
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
    const due = await this.prisma.pointTransaction.findMany({
      where: {
        account: { programId },
        type: "EARN",
        settledAt: null,
        reversedById: null,
        availableAt: { lte: now },
      },
      select: { id: true, accountId: true, amount: true, programId: true },
    });

    let settled = 0;
    for (const tx of due) {
      const moved = await this.prisma.$transaction(async (db) => {
        const claimed = await db.pointTransaction.updateMany({
          where: { id: tx.id, settledAt: null, reversedById: null },
          data: { settledAt: now },
        });
        if (claimed.count === 0) return false;

        const locked = await this.lockAccount(db, tx.accountId);
        const debtAfter = Math.max(0, locked.debt - tx.amount);
        const lotAmount = Math.max(0, tx.amount - locked.debt);
        await db.pointAccount.update({
          where: { id: tx.accountId },
          data: {
            pendingBalance: { decrement: tx.amount },
            balance: { increment: tx.amount },
            debt: debtAfter,
          },
        });
        if (lotAmount > 0) {
          await db.pointLot.create({
            data: {
              accountId: tx.accountId,
              programId: tx.programId,
              sourceTxId: tx.id,
              originalAmount: lotAmount,
              remaining: lotAmount,
              expiresAt: null,
            },
          });
        }
        return true;
      });
      if (moved) settled++;
    }
    return settled;
  }

  /**
   * Expires EARN transactions past the legacy per-EARN `expiresAt`. Removes at most
   * the current spendable balance (never below zero) and consumes the matching
   * lots so the lot/debt invariant holds. In PR A every lot has `expiresAt = null`,
   * so the lot-driven expiry is deferred; this keeps the legacy behaviour while
   * still moving spendable value through lots.
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

        // Lock the account row before reading its balance so a concurrent
        // redemption cannot spend between the read and the decrement.
        const account = await this.lockAccount(db, tx.accountId);
        const amount = Math.min(tx.amount, Math.max(account.balance, 0));
        await this.consumeLots(db, tx.accountId, amount, tx.id);
        const updated = await db.pointAccount.update({
          where: { id: tx.accountId },
          data: { balance: { decrement: amount } },
        });
        const created = await db.pointTransaction.create({
          data: {
            accountId: tx.accountId,
            programId,
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
      return { confirmed: 0, pendingBalance: 0, total: 0, nextAvailableAt: null };
    }
    let nextAvailableAt: Date | null = null;
    if (account.pendingBalance > 0) {
      const earliest = await this.repo.findNextAvailableAt(account.id);
      nextAvailableAt = earliest?.availableAt ?? null;
    }
    return {
      confirmed: account.balance,
      pendingBalance: account.pendingBalance,
      total: account.balance + account.pendingBalance,
      nextAvailableAt,
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
   * Locks the account row inside the current transaction. Every operation that
   * touches lots takes this lock first, so concurrent requests serialize and
   * cannot double-consume the same lot.
   */
  private async lockAccount(
    db: Prisma.TransactionClient,
    accountId: string,
  ): Promise<{ balance: number; debt: number }> {
    const rows = await db.$queryRaw<{ balance: number; debt: number }[]>(
      Prisma.sql`SELECT "balance", "debt" FROM "PointAccount" WHERE "id" = ${accountId} FOR UPDATE`,
    );
    const account = rows[0];
    if (!account) throw new Error(`PointAccount ${accountId} missing`);
    return account;
  }

  /**
   * Consumes `amount` of spendable value from the account's lots in FIFO order
   * (`expiresAt ASC NULLS LAST, createdAt ASC`). When `ownSourceTxId` is given, that
   * lot is consumed first. Returns the shortfall (the amount no lot could cover).
   */
  private async consumeLots(
    db: Prisma.TransactionClient,
    accountId: string,
    amount: number,
    ownSourceTxId?: string,
  ): Promise<number> {
    const rows = await db.$queryRaw<{ id: string; sourceTxId: string | null; remaining: number }[]>(
      Prisma.sql`SELECT "id", "sourceTxId", "remaining" FROM "PointLot"
        WHERE "accountId" = ${accountId} AND "remaining" > 0
        ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC, "id" ASC
        FOR UPDATE`,
    );

    const lots = [...rows];
    if (ownSourceTxId) {
      const idx = lots.findIndex((lot) => lot.sourceTxId === ownSourceTxId);
      if (idx > 0) {
        const [own] = lots.splice(idx, 1);
        if (own) lots.unshift(own);
      }
    }

    let toConsume = amount;
    for (const lot of lots) {
      if (toConsume <= 0) break;
      const take = Math.min(lot.remaining, toConsume);
      if (take > 0) {
        await db.pointLot.update({
          where: { id: lot.id },
          data: { remaining: { decrement: take } },
        });
        toConsume -= take;
      }
    }
    return toConsume;
  }

  /**
   * Hold period for a program, falling back to the constructor option when the
   * program row is missing (e.g. during bootstrap).
   */
  private async programHoldDays(programId: string): Promise<number> {
    const days = await this.repo.findProgramHoldDays(programId);
    return days ?? this.holdDays;
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

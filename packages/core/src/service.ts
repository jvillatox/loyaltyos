import { type ExpiryMode, Prisma, type PrismaClient } from "@prisma/client";

import { addMonths, lotExpiresAt } from "./expiry.js";
import { applyTxToBalance } from "./ledger.js";
import { createRepository } from "./repository.js";
import { calculateEffectiveAmount, evaluateRules } from "./rules.js";
import type {
  AdjustInput,
  AdjustResult,
  Balance,
  EarnInput,
  EarnResult,
  NextExpiry,
  PaginatedResult,
  PaginationParams,
  RedeemInput,
  RedeemResult,
  ReverseResult,
  UpcomingExpiry,
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
    const program = await this.programExpiry(input.programId);

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
              expiresAt: lotExpiresAt(program.mode, program.months, availableAt ?? now),
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
    const program = await this.programExpiry(input.programId);
    try {
      const { tx, balanceAfter } = await this.prisma.$transaction(async (db) => {
        const locked = await this.lockAccount(db, account.id);
        const now = new Date();

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
            settledAt: now,
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
              expiresAt: lotExpiresAt(program.mode, program.months, now),
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
    const program = await this.programExpiry(programId);

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
            expiresAt: lotExpiresAt(program.mode, program.months, new Date()),
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
      select: { id: true, accountId: true, amount: true, programId: true, availableAt: true },
    });

    const program = await this.programExpiry(programId);
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
              expiresAt: lotExpiresAt(program.mode, program.months, tx.availableAt ?? now),
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
   * Expires spendable points according to the program's `expiryMode`:
   * - PER_LOT: each expired lot (remaining > 0, expiresAt <= now) is expired by
   *   its remaining amount, idempotently per lot.
   * - INACTIVITY: an account with a positive balance whose anchor
   *   (`max(lastActivityAt, expiryChangedAt)`, or `expiryChangedAt` when there is
   *   no activity) plus `expiryMonths` has passed expires all its lots, idempotently
   *   per account and expiry date.
   * - NONE: nothing ever expires.
   */
  async expire(programId: string, now: Date = new Date()): Promise<number> {
    const program = await this.programExpiry(programId);
    if (program.mode === "NONE") return 0;
    if (program.mode === "PER_LOT") {
      await this.backfillLotExpiry(programId, program);
      return this.expireLots(programId, now);
    }
    return this.expireInactiveAccounts(programId, program, now);
  }

  /**
   * Self-heals PER_LOT lots that have no expiry (e.g. created while the mode was
   * switching): assigns `max(createdAt, expiryChangedAt) + expiryMonths` so they
   * are picked up by the next `expireLots` pass instead of never expiring.
   */
  private async backfillLotExpiry(
    programId: string,
    program: { mode: ExpiryMode; months: number; changedAt: Date | null },
  ): Promise<void> {
    if (!program.changedAt) return;
    const lots = await this.repo.findLotsWithoutExpiry(programId);
    for (const lot of lots) {
      const base = lot.createdAt > program.changedAt ? lot.createdAt : program.changedAt;
      await this.prisma.pointLot.update({
        where: { id: lot.id },
        data: { expiresAt: addMonths(base, program.months) },
      });
    }
  }

  private async expireLots(programId: string, now: Date): Promise<number> {
    const lots = await this.repo.findExpiredLots(programId, now);
    let expired = 0;
    for (const lot of lots) {
      try {
        const key = `expire-${lot.id}`;
        const done = await this.prisma.$transaction(async (db) => {
          // Serialize on the account row, then re-read the lot so a concurrent
          // expiry or redemption cannot double-consume it.
          const account = await this.lockAccount(db, lot.accountId);
          const current = await db.pointLot.findUnique({ where: { id: lot.id } });
          if (!current || current.remaining <= 0) return false;
          const amount = Math.min(current.remaining, account.balance);
          if (amount <= 0) return false;

          await db.pointLot.update({
            where: { id: lot.id },
            data: { remaining: { decrement: amount } },
          });
          const updated = await db.pointAccount.update({
            where: { id: lot.accountId },
            data: { balance: { decrement: amount } },
          });
          await db.pointTransaction.create({
            data: {
              accountId: lot.accountId,
              programId,
              type: "EXPIRE",
              amount,
              balanceAfter: updated.balance,
              source: "system:expire",
              idempotencyKey: key,
              description: `Expired lot ${lot.id}`,
              settledAt: now,
            },
          });
          return true;
        });
        if (done) {
          this.metrics?.recordExpire(programId);
          expired++;
        }
      } catch (err) {
        console.error(`[Expiry] failed to expire lot ${lot.id}:`, err);
      }
    }
    return expired;
  }

  private async expireInactiveAccounts(
    programId: string,
    program: { mode: ExpiryMode; months: number; changedAt: Date | null },
    now: Date,
  ): Promise<number> {
    if (!program.changedAt) return 0;
    const accounts = await this.repo.findActiveAccounts(programId);
    let expired = 0;
    for (const account of accounts) {
      try {
        const anchor = account.lastActivityAt
          ? new Date(Math.max(account.lastActivityAt.getTime(), program.changedAt.getTime()))
          : program.changedAt;
        const expiresAt = addMonths(anchor, program.months);
        if (expiresAt > now) continue;

        // One EXPIRE per account per day, so points that arrive after an expiry
        // (e.g. a non-activity adjustment) can expire on a later run without
        // colliding with the previous day's idempotency key.
        const key = `expire-inactive-${account.id}-${now.toISOString().slice(0, 10)}`;
        const done = await this.prisma.$transaction(async (db) => {
          const locked = await this.lockAccount(db, account.id);
          const amount = Math.max(locked.balance, 0);
          if (amount <= 0) return false;
          await this.consumeLots(db, account.id, amount);
          const updated = await db.pointAccount.update({
            where: { id: account.id },
            data: { balance: { decrement: amount } },
          });
          await db.pointTransaction.create({
            data: {
              accountId: account.id,
              programId,
              type: "EXPIRE",
              amount,
              balanceAfter: updated.balance,
              source: "system:expire",
              idempotencyKey: key,
              description: `Expired inactive account points on ${expiresAt.toISOString()}`,
              settledAt: now,
            },
          });
          return true;
        });
        if (done) {
          this.metrics?.recordExpire(programId);
          expired++;
        }
      } catch (err) {
        console.error(`[Expiry] failed to expire account ${account.id}:`, err);
      }
    }
    return expired;
  }

  async balance(memberId: string, programId: string): Promise<Balance> {
    const account = await this.repo.findAccount(memberId, programId);
    if (!account) {
      return { confirmed: 0, pendingBalance: 0, total: 0, nextAvailableAt: null, nextExpiry: null };
    }
    let nextAvailableAt: Date | null = null;
    if (account.pendingBalance > 0) {
      const earliest = await this.repo.findNextAvailableAt(account.id);
      nextAvailableAt = earliest?.availableAt ?? null;
    }
    const nextExpiry = await this.computeNextExpiry(programId, account);
    return {
      confirmed: account.balance,
      pendingBalance: account.pendingBalance,
      total: account.balance + account.pendingBalance,
      nextAvailableAt,
      nextExpiry,
    };
  }

  /**
   * Returns the spendable-points deadlines that fall in `(now, now + horizonDays]`,
   * the window that should trigger a reminder. For `PER_LOT` the lots sharing one
   * `expiresAt` are grouped into a single deadline per member; for `INACTIVITY`
   * the deadline is `max(lastActivityAt, expiryChangedAt) + expiryMonths`.
   * `NONE` never expires, so it returns nothing.
   */
  async upcomingExpiries(
    programId: string,
    now: Date = new Date(),
    horizonDays = 30,
  ): Promise<UpcomingExpiry[]> {
    const program = await this.programExpiry(programId);
    if (program.mode === "NONE") return [];
    const horizon = new Date(now.getTime() + horizonDays * DAY_MS);

    if (program.mode === "PER_LOT") {
      const lots = await this.repo.findUpcomingExpiringLots(programId, now, horizon);
      const grouped = new Map<string, UpcomingExpiry>();
      for (const lot of lots) {
        if (!lot.expiresAt) continue;
        const key = `${lot.account.memberId}|${String(lot.expiresAt.getTime())}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.amount += lot.remaining;
        } else {
          grouped.set(key, {
            memberId: lot.account.memberId,
            amount: lot.remaining,
            expiresOn: lot.expiresAt,
            mode: "PER_LOT",
          });
        }
      }
      return [...grouped.values()];
    }

    // INACTIVITY
    if (!program.changedAt) return [];
    const accounts = await this.repo.findActiveAccounts(programId);
    const deadlines: UpcomingExpiry[] = [];
    for (const account of accounts) {
      const anchor = account.lastActivityAt
        ? new Date(Math.max(account.lastActivityAt.getTime(), program.changedAt.getTime()))
        : program.changedAt;
      const expiresOn = addMonths(anchor, program.months);
      if (expiresOn > now && expiresOn <= horizon) {
        deadlines.push({
          memberId: account.memberId,
          amount: account.balance,
          expiresOn,
          mode: "INACTIVITY",
        });
      }
    }
    return deadlines;
  }

  /**
   * Sends one reminder per upcoming `(member, expiry date)` deadline, idempotently.
   * The `PointExpiryReminder` unique constraint is the dedup mechanism: a
   * concurrent run that loses the INSERT race skips, so `send` is invoked exactly
   * once per deadline. Returns the number of reminders actually sent this run.
   */
  async remindUpcomingExpiries(
    programId: string,
    now: Date = new Date(),
    send: (deadline: UpcomingExpiry) => Promise<void>,
    horizonDays = 30,
  ): Promise<number> {
    const deadlines = await this.upcomingExpiries(programId, now, horizonDays);
    let sent = 0;
    for (const deadline of deadlines) {
      try {
        await this.prisma.pointExpiryReminder.create({
          data: {
            memberId: deadline.memberId,
            programId,
            expiresOn: deadline.expiresOn,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      await send(deadline);
      sent++;
    }
    return sent;
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

  /** Expiry rule for a program, falling back to "never expire" when missing. */
  private async programExpiry(
    programId: string,
  ): Promise<{ mode: ExpiryMode; months: number; changedAt: Date | null }> {
    const program = await this.repo.findProgramExpiry(programId);
    return {
      mode: program?.expiryMode ?? "NONE",
      months: program?.expiryMonths ?? 12,
      changedAt: program?.expiryChangedAt ?? null,
    };
  }

  private async computeNextExpiry(
    programId: string,
    account: { id: string; balance: number; lastActivityAt: Date | null },
  ): Promise<NextExpiry | null> {
    const program = await this.programExpiry(programId);

    if (program.mode === "PER_LOT") {
      const next = await this.repo.findNextExpiringLot(account.id);
      if (!next?.expiresAt) return null;
      const lots = await this.repo.findLotsExpiringAt(account.id, next.expiresAt);
      const amount = lots.reduce((sum, lot) => sum + lot.remaining, 0);
      return { amount, date: next.expiresAt, mode: "PER_LOT" };
    }

    if (program.mode === "INACTIVITY") {
      if (account.balance <= 0 || !program.changedAt) return null;
      const anchor = account.lastActivityAt
        ? new Date(Math.max(account.lastActivityAt.getTime(), program.changedAt.getTime()))
        : program.changedAt;
      return {
        amount: account.balance,
        date: addMonths(anchor, program.months),
        mode: "INACTIVITY",
      };
    }

    return null;
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

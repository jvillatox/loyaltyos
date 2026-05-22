import type { Prisma, PrismaClient } from "@prisma/client";

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

export class PointsService {
  private repo: ReturnType<typeof createRepository>;
  private metrics?: PointsServiceMetrics;

  constructor(prisma: PrismaClient, metrics?: PointsServiceMetrics) {
    this.repo = createRepository(prisma);
    this.metrics = metrics;
  }

  async earn(input: EarnInput): Promise<EarnResult> {
    // Idempotency check
    const existing = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.metrics?.recordEarn(input.programId, existing.amount, true);
      return {
        transactionId: existing.id,
        amount: existing.amount,
        multiplier: 1.0,
        balanceAfter: existing.balanceAfter,
        idempotent: true,
      };
    }

    // Apply point rules
    const rules = await this.repo.findActiveRules(input.programId, "purchase");
    const evaluation = evaluateRules(rules, input.metadata);
    const effective = calculateEffectiveAmount(input.amount, evaluation.multiplier);

    // Get or create account
    const account = await this.repo.findOrCreateAccount(input.memberId, input.programId);

    const balanceAfter = account.balance + effective.total;
    const pendingAfter = account.pendingBalance + effective.total;

    // Create transaction (points are pending until settlement may not apply for EARN)
    const tx = await this.repo.createTx({
      accountId: account.id,
      type: "EARN",
      amount: effective.total,
      balanceAfter,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      expiresAt: input.expiresAt,
    });

    // Update account balance
    await this.repo.updateBalance(account.id, balanceAfter, pendingAfter);

    this.metrics?.recordEarn(input.programId, effective.total, false);
    this.metrics?.setProgramBalance(input.programId, balanceAfter);

    return {
      transactionId: tx.id,
      amount: effective.total,
      multiplier: evaluation.multiplier,
      balanceAfter,
      idempotent: false,
    };
  }

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    // Idempotency check
    const existing = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.id,
        amount: existing.amount,
        balanceAfter: existing.balanceAfter,
        idempotent: true,
      };
    }

    const account = await this.repo.findOrCreateAccount(input.memberId, input.programId);

    if (account.balance < input.amount) {
      this.metrics?.recordInsufficientBalance(input.programId);
      throw new InsufficientBalanceError(account.balance, input.amount);
    }

    const balanceAfter = account.balance - input.amount;

    const tx = await this.repo.createTx({
      accountId: account.id,
      type: "REDEEM",
      amount: input.amount,
      balanceAfter,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    });

    await this.repo.updateBalance(account.id, balanceAfter);

    this.metrics?.recordRedeem(input.programId, input.amount);
    this.metrics?.setProgramBalance(input.programId, balanceAfter);

    return {
      transactionId: tx.id,
      amount: input.amount,
      balanceAfter,
      idempotent: false,
    };
  }

  async adjust(input: AdjustInput): Promise<AdjustResult> {
    // Idempotency check
    const existing = await this.repo.findTxByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.id,
        amount: existing.amount,
        balanceAfter: existing.balanceAfter,
      };
    }

    const account = await this.repo.findOrCreateAccount(input.memberId, input.programId);
    const balanceAfter = account.balance + input.amount;

    const tx = await this.repo.createTx({
      accountId: account.id,
      type: "ADJUST",
      amount: input.amount,
      balanceAfter,
      source: `admin:${input.adminUserId}`,
      idempotencyKey: input.idempotencyKey,
      description: input.reason,
    });

    await this.repo.updateBalance(account.id, balanceAfter);

    this.metrics?.recordAdjust(input.programId, input.amount);
    this.metrics?.setProgramBalance(input.programId, balanceAfter);

    return {
      transactionId: tx.id,
      amount: input.amount,
      balanceAfter,
    };
  }

  async reverse(
    txId: string,
    reason: string,
    adminUserId: string,
    idempotencyKey?: string,
  ): Promise<ReverseResult> {
    const key = idempotencyKey ?? `reverse-${txId}-${adminUserId}`;

    // Idempotency check
    const existing = await this.repo.findTxByIdempotencyKey(key);
    if (existing) {
      const originalTx = await this.repo.findTxById(txId);
      if (!originalTx) throw new TransactionNotFoundError(txId);
      return {
        reversalId: existing.id,
        originalType: originalTx.type,
        amountReversed: existing.amount,
      };
    }

    const originalTx = await this.repo.findTxById(txId);
    if (!originalTx) {
      throw new TransactionNotFoundError(txId);
    }

    // Check for existing reversal
    const existingReversal = await this.repo.findReversalForTx(txId);
    if (existingReversal) {
      throw new AlreadyReversedError(txId);
    }

    const account = await this.repo.findAccount(originalTx.accountId, "");
    if (!account) {
      throw new Error(`Account not found for transaction ${txId}`);
    }

    const balanceAfter = account.balance - originalTx.amount;

    const reversalTx = await this.repo.createTx({
      accountId: originalTx.accountId,
      type: "REVERSE",
      amount: originalTx.amount,
      balanceAfter,
      source: `admin:${adminUserId}`,
      idempotencyKey: key,
      description: reason,
    });

    await this.repo.updateBalance(originalTx.accountId, balanceAfter);

    this.metrics?.recordReverse(account.programId, originalTx.type);

    // Link the reversal via a raw update since we removed the relation
    return {
      reversalId: reversalTx.id,
      originalType: originalTx.type,
      amountReversed: originalTx.amount,
    };
  }

  async expire(programId: string): Promise<number> {
    const now = new Date();
    const expiredTxs = await this.repo.findExpiredTransactions(programId, now);

    let expiredCount = 0;

    for (const tx of expiredTxs) {
      const account = tx.account;
      const balanceAfter = account.balance - tx.amount;

      await this.repo.createTx({
        accountId: account.id,
        type: "EXPIRE",
        amount: tx.amount,
        balanceAfter,
        source: "system:expire",
        idempotencyKey: `expire-${tx.id}`,
        description: `Expired from tx ${tx.id}`,
      });

      await this.repo.updateBalance(account.id, balanceAfter);
      this.metrics?.recordExpire(programId);
      expiredCount++;
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
}

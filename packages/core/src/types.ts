import type { TransactionType } from "@prisma/client";

export type { TransactionType };

export interface EarnInput {
  memberId: string;
  programId: string;
  amount: number;
  source: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface RedeemInput {
  memberId: string;
  programId: string;
  amount: number;
  source: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface AdjustInput {
  memberId: string;
  programId: string;
  amount: number;
  reason: string;
  adminUserId: string;
  idempotencyKey: string;
  ipAddress?: string;
}

export interface Balance {
  confirmed: number;
  pendingBalance: number;
  total: number;
  /** Earliest timestamp at which the currently held points become spendable. */
  nextAvailableAt: Date | null;
  /** Earliest upcoming expiry of spendable points, or null when nothing expires. */
  nextExpiry: NextExpiry | null;
}

export interface NextExpiry {
  /** Spendable points that will expire on `date`. */
  amount: number;
  date: Date;
  mode: "PER_LOT" | "INACTIVITY";
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly currentBalance: number,
    public readonly requestedAmount: number,
  ) {
    super(
      `Insufficient balance: have ${String(currentBalance)}, tried to use ${String(requestedAmount)}`,
    );
    this.name = "InsufficientBalanceError";
  }
}

export class DuplicateIdempotencyKeyError extends Error {
  constructor(key: string) {
    super(`Duplicate idempotency key: ${key} with different payload`);
    this.name = "DuplicateIdempotencyKeyError";
  }
}

export class InvalidRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuleError";
  }
}

export class TransactionNotFoundError extends Error {
  constructor(txId: string) {
    super(`Transaction not found: ${txId}`);
    this.name = "TransactionNotFoundError";
  }
}

export class AlreadyReversedError extends Error {
  constructor(txId: string) {
    super(`Transaction ${txId} has already been reversed`);
    this.name = "AlreadyReversedError";
  }
}

export class CannotReverseError extends Error {
  constructor(txId: string) {
    super(`Transaction ${txId} is itself a reversal and cannot be reversed`);
    this.name = "CannotReverseError";
  }
}

export interface EarnResult {
  transactionId: string;
  amount: number;
  multiplier: number;
  balanceAfter: number;
  idempotent: boolean;
}

export interface RedeemResult {
  transactionId: string;
  amount: number;
  balanceAfter: number;
  idempotent: boolean;
}

export interface AdjustResult {
  transactionId: string;
  amount: number;
  balanceAfter: number;
}

export interface ReverseResult {
  reversalId: string;
  originalType: TransactionType;
  amountReversed: number;
}

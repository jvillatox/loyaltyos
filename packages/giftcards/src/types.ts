import type {
  BatchStatus as _BatchStatus,
  GiftCard,
  GiftCardBatch,
  GiftCardStatus as _GiftCardStatus,
  GiftCardTransaction,
  GiftCardTxType as _GiftCardTxType,
  TermsTemplate,
} from "@prisma/client";

// Re-export Prisma enums
export type BatchStatus = _BatchStatus;
export type GiftCardStatus = _GiftCardStatus;
export type GiftCardTxType = _GiftCardTxType;

// Row types
export type GiftCardBatchRow = GiftCardBatch;
export type GiftCardRow = GiftCard;
export type GiftCardTransactionRow = GiftCardTransaction;
export type TermsTemplateRow = TermsTemplate;

// ── Input types ────────────────────────────────

export interface CreateBatchInput {
  programId: string;
  name: string;
  quantity: number;
  initialAmount: number;
  currency: string;
  prefix?: string | undefined;
  expirationDate: Date;
  termsTemplateId: string;
  createdById: string;
}

export interface CreateTermsTemplateInput {
  programId: string;
  name: string;
  locale?: string;
  body: string;
}

export type UpdateTermsTemplateInput = Partial<Omit<CreateTermsTemplateInput, "programId">>;

export interface RedeemInput {
  code: string;
  amount: number;
  memberId?: string;
  idempotencyKey: string;
  orderRef?: string;
}

export interface RefundInput {
  code: string;
  amount: number;
  idempotencyKey: string;
  reason?: string;
}

export interface CancelCardInput {
  code: string;
}

export interface ValidateCodeResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  expirationDate?: Date;
  status?: GiftCardStatus;
  reason?: string;
}

export interface RedeemResult {
  transactionId: string;
  cardId: string;
  amount: number;
  balanceAfter: number;
  currency: string;
  idempotent: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Metrics interface ──────────────────────────

export interface GiftCardsServiceMetrics {
  recordGenerate(programId: string, currency: string, count: number): void;
  recordRedeem(programId: string, currency: string): void;
  recordRedeemedAmount(programId: string, currency: string, amount: number): void;
  setOutstandingBalance(programId: string, currency: string, balance: number): void;
}

// ── Error classes ──────────────────────────────

export class GiftCardNotFoundError extends Error {
  constructor(code: string) {
    super(`Gift card "${code}" not found`);
    this.name = "GiftCardNotFoundError";
  }
}

export class GiftCardExpiredError extends Error {
  constructor(code: string) {
    super(`Gift card "${code}" has expired`);
    this.name = "GiftCardExpiredError";
  }
}

export class GiftCardRedeemedError extends Error {
  constructor(code: string) {
    super(`Gift card "${code}" has already been fully redeemed`);
    this.name = "GiftCardRedeemedError";
  }
}

export class GiftCardCancelledError extends Error {
  constructor(code: string) {
    super(`Gift card "${code}" has been cancelled`);
    this.name = "GiftCardCancelledError";
  }
}

export class GiftCardInsufficientBalanceError extends Error {
  constructor(
    code: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Gift card "${code}" has insufficient balance: requested ${String(requested)}, available ${String(available)}`,
    );
    this.name = "GiftCardInsufficientBalanceError";
  }
}

export class GiftCardBatchNotFoundError extends Error {
  constructor(batchId: string) {
    super(`Gift card batch "${batchId}" not found`);
    this.name = "GiftCardBatchNotFoundError";
  }
}

export class GiftCardInvalidCodeError extends Error {
  constructor(code: string) {
    super(`Gift card code "${code}" is invalid`);
    this.name = "GiftCardInvalidCodeError";
  }
}

export class GiftCardIdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key "${key}" already used with different payload`);
    this.name = "GiftCardIdempotencyConflictError";
  }
}

export class TermsTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Terms template "${id}" not found`);
    this.name = "TermsTemplateNotFoundError";
  }
}

export class GiftCardLockError extends Error {
  constructor(code: string) {
    super(`Gift card "${code}" is currently being processed`);
    this.name = "GiftCardLockError";
  }
}

export class GiftCardNotActiveError extends Error {
  constructor(code: string, status: string) {
    super(`Gift card "${code}" is not active (status: ${status})`);
    this.name = "GiftCardNotActiveError";
  }
}

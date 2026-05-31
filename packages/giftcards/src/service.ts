import crypto from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { generateCode, normalizeCode, validateChecksum } from "./code.js";
import type { RedisLockFn } from "./locks.js";
import { createRepository } from "./repository.js";
import {
  createBatchSchema,
  redeemSchema,
  refundSchema,
  updateTermsTemplateSchema,
  validateCodeSchema,
} from "./schemas.js";
import type {
  CancelCardInput,
  CreateBatchInput,
  CreateTermsTemplateInput,
  GiftCardsServiceMetrics,
  PaginatedResult,
  RedeemInput,
  RedeemResult,
  RefundInput,
  UpdateTermsTemplateInput,
  ValidateCodeResult,
} from "./types.js";
import {
  BatchNotCancellableError,
  GiftCardBatchNotFoundError,
  GiftCardCancelledError,
  GiftCardCodeCollisionError,
  GiftCardExpiredError,
  GiftCardIdempotencyConflictError,
  GiftCardInsufficientBalanceError,
  GiftCardInvalidCodeError,
  GiftCardLockError,
  GiftCardNotActiveError,
  GiftCardNotFoundError,
  RefundExceedsInitialError,
  TermsTemplateNotFoundError,
} from "./types.js";

export type EnqueueFn = (jobName: string, data: Record<string, unknown>) => Promise<void>;

function hashPayload(payload: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class GiftCardService {
  private repo: ReturnType<typeof createRepository>;
  private metrics?: GiftCardsServiceMetrics;
  private codeSecret: string;
  private enqueueGenerate?: EnqueueFn;
  private prisma: PrismaClient;

  constructor(
    prisma: PrismaClient,
    options?: {
      metrics?: GiftCardsServiceMetrics;
      codeSecret?: string;
      enqueueGenerate?: EnqueueFn;
    },
  ) {
    this.prisma = prisma;
    this.repo = createRepository(prisma);
    this.metrics = options?.metrics;
    this.codeSecret = options?.codeSecret ?? "dev-secret";
    this.enqueueGenerate = options?.enqueueGenerate;
  }

  setEnqueueGenerate(fn: EnqueueFn): void {
    this.enqueueGenerate = fn;
  }

  // ── Batch management ──────────────────────

  async createBatch(input: CreateBatchInput) {
    const parsed = createBatchSchema.parse(input);

    // Pre-validate termsTemplateId (J.4)
    const template = await this.repo.findTermsTemplateById(parsed.termsTemplateId);
    if (!template) {
      throw new TermsTemplateNotFoundError(parsed.termsTemplateId);
    }

    const batch = await this.repo.createBatch({
      ...parsed,
      initialAmount: parsed.initialAmount,
      prefix: parsed.prefix ?? undefined,
    });

    if (this.enqueueGenerate) {
      await this.enqueueGenerate("generate", { batchId: batch.id });
    }

    return batch;
  }

  async getBatch(batchId: string) {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new GiftCardBatchNotFoundError(batchId);
    return batch;
  }

  async listBatches(
    programId: string,
    filters: { status?: string; page?: number; pageSize?: number },
  ): Promise<PaginatedResult<unknown>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const { items, total } = await this.repo.findBatches(programId, {
      status: filters.status,
      page,
      pageSize,
    });
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async cancelBatch(batchId: string) {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new GiftCardBatchNotFoundError(batchId);

    if (!["pending", "generating", "partial"].includes(batch.status)) {
      throw new BatchNotCancellableError(batchId, 0);
    }

    // Guard: reject if any cards have been redeemed (I.2)
    const redeemedCount = await this.repo.countRedeemedCardsInBatch(batchId);
    if (redeemedCount > 0) {
      throw new BatchNotCancellableError(batchId, redeemedCount);
    }

    return this.repo.updateBatchStatus(batchId, "cancelled");
  }

  // ── Batch code generation (worker callback) ─

  async generateBatchCodes(batchId: string): Promise<void> {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new GiftCardBatchNotFoundError(batchId);

    // Idempotency guard: if already ready, short-circuit (J.3)
    if (batch.status === "ready") return;

    const { quantity, initialAmount, currency, expirationDate, prefix } = batch;
    const chunkSize = 1000;

    await this.repo.updateBatchStatus(batchId, "generating");

    try {
      let generated = 0;
      let failedChunks = 0;

      while (generated < quantity) {
        const remaining = quantity - generated;
        const currentChunk = Math.min(chunkSize, remaining);

        const inputs = Array.from({ length: currentChunk }, () => {
          const code = generateCode(prefix ?? undefined, this.codeSecret);
          return {
            code,
            batchId,
            initialAmount: Number(initialAmount),
            balance: Number(initialAmount),
            currency,
            expirationDate,
          };
        });

        const created = await this.repo.createCards(inputs);
        if (created < currentChunk) {
          failedChunks++;
          const toGenerate = currentChunk - created;
          const retryInputs = Array.from({ length: toGenerate }, () => {
            const code = generateCode(prefix ?? undefined, this.codeSecret);
            return {
              code,
              batchId,
              initialAmount: Number(initialAmount),
              balance: Number(initialAmount),
              currency,
              expirationDate,
            };
          });
          const retryCreated = await this.repo.createCards(retryInputs);
          generated += created + retryCreated;
          if (created + retryCreated < currentChunk) failedChunks++;
        } else {
          generated += created;
        }

        await this.repo.incrementGeneratedCount(batchId, currentChunk);

        if (failedChunks > 3) {
          throw new GiftCardCodeCollisionError();
        }
      }

      await this.repo.updateBatchStatus(batchId, "ready");
      this.metrics?.recordGenerate(batch.programId, currency, generated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.updateBatchStatus(batchId, "failed", { error: message });
      throw err; // Re-throw so BullMQ classifies as failed (J.2)
    }
  }

  // ── Code validation (public) ──────────────

  async validateCode(input: { code: string; programId?: string }): Promise<ValidateCodeResult> {
    const parsed = validateCodeSchema.parse(input);
    const normalized = normalizeCode(parsed.code);

    // Checksum validation first (no DB hit)
    if (!validateChecksum(parsed.code, this.codeSecret)) {
      // Timing equalization: perform a dummy DB lookup (H.2)
      await this.repo
        .findCardByCode(generateCode(undefined, this.codeSecret))
        .catch(() => undefined);
      return { valid: false, reason: "invalid_code" };
    }

    // DB lookup only for codes with valid checksum
    const card = await this.repo.findCardByCode(normalized);
    if (!card) {
      return { valid: false, reason: "not_found" };
    }

    if (card.status === "expired" || new Date() > card.expirationDate) {
      return { valid: false, reason: "expired" };
    }

    if (card.status === "cancelled") {
      return { valid: false, reason: "cancelled" };
    }

    if (card.status === "depleted") {
      return { valid: false, reason: "depleted" };
    }

    return {
      valid: true,
      balance: Number(card.balance),
      currency: card.currency,
      expirationDate: card.expirationDate,
      status: card.status,
    };
  }

  // ── Redemption ────────────────────────────

  async redeem(input: RedeemInput, acquireLock: RedisLockFn): Promise<RedeemResult> {
    const parsed = redeemSchema.parse(input);
    const normalized = normalizeCode(parsed.code);

    // Validate checksum before anything
    if (!validateChecksum(parsed.code, this.codeSecret)) {
      throw new GiftCardInvalidCodeError(parsed.code);
    }

    // Load card first to get programId for scoped idempotency check
    const card = await this.repo.findCardByCode(normalized);
    if (!card) throw new GiftCardNotFoundError(parsed.code);

    // Cross-tenant guard (A.3)
    if (card.batch.programId !== parsed.requestProgramId) {
      throw new GiftCardNotFoundError(parsed.code);
    }
    const programId = card.batch.programId;

    // Build payload hash (D.2)
    const payloadHash = hashPayload({
      code: normalized,
      amount: parsed.amount,
      memberId: parsed.memberId ?? null,
      orderRef: parsed.orderRef ?? null,
    });

    // Idempotency check (scoped to program — D.3)
    const existing = await this.repo.findTransactionByIdempotencyKey(
      programId,
      parsed.idempotencyKey,
    );
    if (existing) {
      if (existing.idempotencyPayloadHash !== payloadHash) {
        throw new GiftCardIdempotencyConflictError(parsed.idempotencyKey);
      }
      return {
        transactionId: existing.id,
        cardId: existing.giftCardId,
        amount: Number(existing.amount),
        balanceAfter: Number(card.balance),
        currency: card.currency,
        idempotent: true,
      };
    }

    // Acquire Redis lock (TTL 30s — B.4)
    const lock = await acquireLock(normalized, 30);
    if (!lock.acquired) {
      throw new GiftCardLockError(parsed.code);
    }

    try {
      // Re-read card inside lock
      const locked = await this.repo.findCardByCode(normalized);
      if (!locked) throw new GiftCardNotFoundError(parsed.code);

      if (locked.status === "expired" || new Date() > locked.expirationDate) {
        throw new GiftCardExpiredError(parsed.code);
      }
      if (locked.status === "cancelled") throw new GiftCardCancelledError(parsed.code);
      if (locked.status === "depleted") {
        throw new GiftCardInsufficientBalanceError(parsed.code, parsed.amount, 0);
      }
      if (locked.status !== "active" && locked.status !== "partially_redeemed") {
        throw new GiftCardNotActiveError(parsed.code, locked.status);
      }

      // Decimal math (F.1)
      const balance = locked.balance;
      const amount = new Prisma.Decimal(parsed.amount);
      if (balance.lessThan(amount)) {
        throw new GiftCardInsufficientBalanceError(parsed.code, parsed.amount, Number(balance));
      }

      const balanceAfter = balance.minus(amount);
      const newStatus = balanceAfter.equals(0) ? "depleted" : "partially_redeemed";

      const now = new Date();

      // Wrap state changes in $transaction (B.5)
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await this.repo.updateCardBalance(
          locked.id,
          parsed.amount,
          newStatus as string,
          {
            activatedAt: locked.activatedAt ?? now,
            lastRedemptionAt: now,
          },
          tx,
        );

        const txn = await this.repo.createTransaction(
          {
            giftCardId: locked.id,
            type: "redeem",
            amount: parsed.amount,
            balanceAfter: Number(balanceAfter),
            memberId: parsed.memberId,
            idempotencyKey: parsed.idempotencyKey,
            idempotencyPayloadHash: payloadHash,
            programId,
            orderRef: parsed.orderRef,
            createdById: parsed.createdById,
          },
          tx,
        );

        return { updated, txn };
      });

      this.metrics?.recordRedeem(card.batch.programId, locked.currency);
      this.metrics?.recordRedeemedAmount(card.batch.programId, locked.currency, parsed.amount);

      return {
        transactionId: result.txn.id,
        cardId: locked.id,
        amount: parsed.amount,
        balanceAfter: Number(result.updated.balance),
        currency: locked.currency,
        idempotent: false,
      };
    } finally {
      await lock.release();
    }
  }

  // ── Refund ────────────────────────────────

  async refund(input: RefundInput, acquireLock: RedisLockFn): Promise<RedeemResult> {
    const parsed = refundSchema.parse(input);
    const normalized = normalizeCode(parsed.code);

    const card = await this.repo.findCardByCode(normalized);
    if (!card) throw new GiftCardNotFoundError(parsed.code);

    // Cross-tenant guard (A.3)
    if (card.batch.programId !== parsed.requestProgramId) {
      throw new GiftCardNotFoundError(parsed.code);
    }
    const programId = card.batch.programId;

    // Build payload hash (D.2)
    const payloadHash = hashPayload({
      code: normalized,
      amount: parsed.amount,
      reason: parsed.reason ?? null,
    });

    // Idempotency check (scoped to program — D.3)
    const existing = await this.repo.findTransactionByIdempotencyKey(
      programId,
      parsed.idempotencyKey,
    );
    if (existing) {
      if (existing.idempotencyPayloadHash !== payloadHash) {
        throw new GiftCardIdempotencyConflictError(parsed.idempotencyKey);
      }
      return {
        transactionId: existing.id,
        cardId: existing.giftCardId,
        amount: Number(existing.amount),
        balanceAfter: Number(card.balance),
        currency: card.currency,
        idempotent: true,
      };
    }

    // Acquire Redis lock (B.2, B.4)
    const lock = await acquireLock(normalized, 30);
    if (!lock.acquired) {
      throw new GiftCardLockError(parsed.code);
    }

    try {
      const locked = await this.repo.findCardByCode(normalized);
      if (!locked) throw new GiftCardNotFoundError(parsed.code);

      const balance = locked.balance;
      const initialAmount = locked.initialAmount;
      const refundAmount = new Prisma.Decimal(parsed.amount);
      const newBalance = balance.plus(refundAmount);

      if (newBalance.greaterThan(initialAmount)) {
        throw new RefundExceedsInitialError(
          parsed.code,
          Number(initialAmount),
          Number(balance),
          parsed.amount,
        );
      }

      const newStatus = newBalance.equals(initialAmount) ? "active" : "partially_redeemed";

      // Wrap state changes in $transaction (B.5)
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await this.repo.restoreCardBalance(
          locked.id,
          parsed.amount,
          newStatus as string,
          tx,
        );

        const txn = await this.repo.createTransaction(
          {
            giftCardId: locked.id,
            type: "refund",
            amount: parsed.amount,
            balanceAfter: Number(newBalance),
            idempotencyKey: parsed.idempotencyKey,
            idempotencyPayloadHash: payloadHash,
            programId,
            createdById: parsed.createdById,
          },
          tx,
        );

        return { updated, txn };
      });

      return {
        transactionId: result.txn.id,
        cardId: locked.id,
        amount: parsed.amount,
        balanceAfter: Number(result.updated.balance),
        currency: locked.currency,
        idempotent: false,
      };
    } finally {
      await lock.release();
    }
  }

  // ── Cancel card ───────────────────────────

  async cancelCard(input: CancelCardInput, acquireLock: RedisLockFn) {
    const normalized = normalizeCode(input.code);
    const card = await this.repo.findCardByCode(normalized);
    if (!card) throw new GiftCardNotFoundError(input.code);

    // Cross-tenant guard (A.3)
    if (card.batch.programId !== input.requestProgramId) {
      throw new GiftCardNotFoundError(input.code);
    }
    const programId = card.batch.programId;

    if (card.status === "cancelled") throw new GiftCardCancelledError(input.code);

    // Acquire Redis lock (B.2, B.4)
    const lock = await acquireLock(normalized, 30);
    if (!lock.acquired) {
      throw new GiftCardLockError(input.code);
    }

    try {
      // Wrap state changes in $transaction (B.5)
      await this.prisma.$transaction(async (tx) => {
        await this.repo.updateCardStatus(card.id, "cancelled", { balance: 0 }, tx);
        await this.repo.createTransaction(
          {
            giftCardId: card.id,
            type: "cancel",
            amount: Number(card.balance),
            balanceAfter: 0,
            programId,
            createdById: input.createdById,
          },
          tx,
        );
      });

      return this.repo.findCardByCode(normalized);
    } finally {
      await lock.release();
    }
  }

  // ── Transactions ──────────────────────────

  async getTransactions(
    cardId: string,
    filters: { page?: number; pageSize?: number; type?: string },
  ): Promise<PaginatedResult<unknown>> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    const { items, total } = await this.repo.findTransactionsByCard(cardId, {
      page,
      pageSize,
      type: filters.type,
    });
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ── Expiration processing ─────────────────

  async processExpiredCards(): Promise<number> {
    const now = new Date();
    let count = 0;
    let cursor: string | undefined;

    // Pagination loop (J.6)
    // eslint-disable-next-line no-constant-condition, @typescript-eslint/no-unnecessary-condition
    while (true) {
      const cards = await this.repo.findActiveExpired(now, 1000, cursor);

      for (const card of cards) {
        // Wrap each card's state change in its own $transaction
        await this.prisma.$transaction(async (tx) => {
          await this.repo.updateCardStatus(card.id, "expired", undefined, tx);
          await this.repo.createTransaction(
            {
              giftCardId: card.id,
              type: "expire",
              amount: Number(card.balance),
              balanceAfter: 0,
              programId: card.batch.programId,
            },
            tx,
          );
        });
        count++;
      }

      if (cards.length < 1000) break;
      cursor = cards[cards.length - 1]?.id;
    }

    return count;
  }

  // ── Terms templates CRUD ──────────────────

  async createTermsTemplate(input: CreateTermsTemplateInput) {
    return this.repo.createTermsTemplate(input);
  }

  async getTermsTemplate(id: string) {
    const template = await this.repo.findTermsTemplateById(id);
    if (!template) throw new TermsTemplateNotFoundError(id);
    return template;
  }

  async listTermsTemplates(programId: string) {
    return this.repo.findTermsTemplates(programId);
  }

  async updateTermsTemplate(id: string, input: UpdateTermsTemplateInput) {
    const parsed = updateTermsTemplateSchema.parse(input);
    const existing = await this.repo.findTermsTemplateById(id);
    if (!existing) throw new TermsTemplateNotFoundError(id);
    // Create a new version row with bumped version number
    return this.repo.createTermsTemplate({
      programId: existing.programId,
      name: parsed.name ?? existing.name,
      locale: parsed.locale ?? existing.locale,
      body: parsed.body ?? existing.body,
    });
  }

  async deleteTermsTemplate(id: string): Promise<void> {
    const template = await this.repo.findTermsTemplateById(id);
    if (!template) throw new TermsTemplateNotFoundError(id);
    await this.repo.softDeleteTermsTemplate(id);
  }

  // ── Metrics ───────────────────────────────

  async getMetrics(programId: string) {
    return this.repo.countCardsByStatus(programId);
  }

  async getOutstandingBalances(): Promise<
    { programId: string; currency: string; total: number }[]
  > {
    return this.repo.sumOutstandingBalances();
  }
}

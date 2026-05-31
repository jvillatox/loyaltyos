import type { PrismaClient } from "@prisma/client";

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
  GiftCardBatchNotFoundError,
  GiftCardCancelledError,
  GiftCardExpiredError,
  GiftCardInsufficientBalanceError,
  GiftCardInvalidCodeError,
  GiftCardLockError,
  GiftCardNotActiveError,
  GiftCardNotFoundError,
  TermsTemplateNotFoundError,
} from "./types.js";

export type EnqueueFn = (jobName: string, data: Record<string, unknown>) => Promise<void>;

export class GiftCardService {
  private repo: ReturnType<typeof createRepository>;
  private metrics?: GiftCardsServiceMetrics;
  private codeSecret: string;
  private enqueueGenerate?: EnqueueFn;

  constructor(
    prisma: PrismaClient,
    options?: {
      metrics?: GiftCardsServiceMetrics;
      codeSecret?: string;
      enqueueGenerate?: EnqueueFn;
    },
  ) {
    this.repo = createRepository(prisma);
    this.metrics = options?.metrics;
    this.codeSecret = options?.codeSecret ?? process.env.GIFTCARD_HMAC_SECRET ?? "dev-secret";
    this.enqueueGenerate = options?.enqueueGenerate;
  }

  setEnqueueGenerate(fn: EnqueueFn): void {
    this.enqueueGenerate = fn;
  }

  // ── Batch management ──────────────────────

  async createBatch(input: CreateBatchInput) {
    const parsed = createBatchSchema.parse(input);
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
      throw new Error(`Cannot cancel batch in status: ${batch.status}`);
    }
    return this.repo.updateBatchStatus(batchId, "cancelled");
  }

  // ── Batch code generation (worker callback) ─

  async generateBatchCodes(batchId: string): Promise<void> {
    const batch = await this.repo.findBatchById(batchId);
    if (!batch) throw new GiftCardBatchNotFoundError(batchId);

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
          // Regenerate only the missing codes
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
          throw new Error("Too many code collisions during generation");
        }
      }

      await this.repo.updateBatchStatus(batchId, "ready");
      this.metrics?.recordGenerate(batch.programId, currency, generated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.updateBatchStatus(batchId, "failed", { error: message });
    }
  }

  // ── Code validation (public) ──────────────

  async validateCode(input: { code: string; programId?: string }): Promise<ValidateCodeResult> {
    const parsed = validateCodeSchema.parse(input);
    const normalized = normalizeCode(parsed.code);

    // Checksum validation first (no DB hit)
    if (!validateChecksum(parsed.code, this.codeSecret)) {
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

    // Idempotency check
    const existing = await this.repo.findTransactionByIdempotencyKey(parsed.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.id,
        cardId: existing.giftCardId,
        amount: Number(existing.amount),
        balanceAfter: Number(existing.balanceAfter),
        currency: "",
        idempotent: true,
      };
    }

    // Acquire Redis lock
    const lock = await acquireLock(normalized, 5);
    if (!lock.acquired) {
      throw new GiftCardLockError(parsed.code);
    }

    try {
      const card = await this.repo.findCardByCode(normalized);
      if (!card) throw new GiftCardNotFoundError(parsed.code);

      if (card.status === "expired" || new Date() > card.expirationDate) {
        throw new GiftCardExpiredError(parsed.code);
      }
      if (card.status === "cancelled") throw new GiftCardCancelledError(parsed.code);
      if (card.status === "depleted") {
        throw new GiftCardInsufficientBalanceError(parsed.code, parsed.amount, 0);
      }
      if (card.status !== "active" && card.status !== "partially_redeemed") {
        throw new GiftCardNotActiveError(parsed.code, card.status);
      }

      const balance = Number(card.balance);
      if (balance < parsed.amount) {
        throw new GiftCardInsufficientBalanceError(parsed.code, parsed.amount, balance);
      }

      const balanceAfter = balance - parsed.amount;
      const newStatus = balanceAfter === 0 ? "depleted" : "partially_redeemed";

      const now = new Date();
      const updated = await this.repo.updateCardBalance(card.id, parsed.amount, newStatus, {
        activatedAt: card.activatedAt ?? now,
        lastRedemptionAt: now,
      });

      const tx = await this.repo.createTransaction({
        giftCardId: card.id,
        type: "redeem",
        amount: parsed.amount,
        balanceAfter,
        memberId: parsed.memberId,
        idempotencyKey: parsed.idempotencyKey,
        orderRef: parsed.orderRef,
      });

      this.metrics?.recordRedeem(card.batch.programId, card.currency);
      this.metrics?.recordRedeemedAmount(card.batch.programId, card.currency, parsed.amount);

      return {
        transactionId: tx.id,
        cardId: card.id,
        amount: parsed.amount,
        balanceAfter: Number(updated.balance),
        currency: card.currency,
        idempotent: false,
      };
    } finally {
      await lock.release();
    }
  }

  // ── Refund ────────────────────────────────

  async refund(input: RefundInput): Promise<RedeemResult> {
    const parsed = refundSchema.parse(input);
    const normalized = normalizeCode(parsed.code);

    const existing = await this.repo.findTransactionByIdempotencyKey(parsed.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.id,
        cardId: existing.giftCardId,
        amount: Number(existing.amount),
        balanceAfter: Number(existing.balanceAfter),
        currency: "",
        idempotent: true,
      };
    }

    const card = await this.repo.findCardByCode(normalized);
    if (!card) throw new GiftCardNotFoundError(parsed.code);

    const balance = Number(card.balance);
    const initialAmount = Number(card.initialAmount);
    const newBalance = balance + parsed.amount;

    if (newBalance > initialAmount) {
      throw new Error(
        `Refund would exceed initial amount of ${String(initialAmount)} (current balance: ${String(balance)}, refund: ${String(parsed.amount)})`,
      );
    }

    const newStatus = newBalance === initialAmount ? "active" : "partially_redeemed";

    const updated = await this.repo.restoreCardBalance(card.id, parsed.amount, newStatus);

    const tx = await this.repo.createTransaction({
      giftCardId: card.id,
      type: "refund",
      amount: parsed.amount,
      balanceAfter: newBalance,
      idempotencyKey: parsed.idempotencyKey,
    });

    return {
      transactionId: tx.id,
      cardId: card.id,
      amount: parsed.amount,
      balanceAfter: Number(updated.balance),
      currency: card.currency,
      idempotent: false,
    };
  }

  // ── Cancel card ───────────────────────────

  async cancelCard(input: CancelCardInput) {
    const normalized = normalizeCode(input.code);
    const card = await this.repo.findCardByCode(normalized);
    if (!card) throw new GiftCardNotFoundError(input.code);

    if (card.status === "cancelled") throw new GiftCardCancelledError(input.code);

    await this.repo.updateCardStatus(card.id, "cancelled", { balance: 0 });
    await this.repo.createTransaction({
      giftCardId: card.id,
      type: "cancel",
      amount: Number(card.balance),
      balanceAfter: 0,
    });

    return this.repo.findCardByCode(normalized);
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
    const cards = await this.repo.findActiveExpired(now);
    let count = 0;

    for (const card of cards) {
      await this.repo.updateCardStatus(card.id, "expired");
      await this.repo.createTransaction({
        giftCardId: card.id,
        type: "expire",
        amount: Number(card.balance),
        balanceAfter: 0,
      });
      count++;
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
}

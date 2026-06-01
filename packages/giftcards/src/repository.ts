import type {
  GiftCard,
  GiftCardBatch,
  GiftCardTransaction,
  Prisma,
  PrismaClient,
  TermsTemplate,
} from "@prisma/client";

import type {
  CreateBatchInput,
  CreateTermsTemplateInput,
  UpdateTermsTemplateInput,
} from "./types.js";
import { GiftCardConcurrentUpdateError } from "./types.js";

type Tx = Prisma.TransactionClient;

export function createRepository(prisma: PrismaClient) {
  const db = (tx?: Tx) => tx ?? prisma;

  return {
    // ── Batch operations ──────────────────

    async createBatch(input: CreateBatchInput, tx?: Tx): Promise<GiftCardBatch> {
      return db(tx).giftCardBatch.create({ data: input });
    },

    async findBatchById(id: string, tx?: Tx): Promise<GiftCardBatch | null> {
      return db(tx).giftCardBatch.findUnique({
        where: { id },
        include: { giftCards: { select: { id: true } } },
      });
    },

    async findBatches(
      programId: string,
      filters: { status?: string; page?: number; pageSize?: number },
      tx?: Tx,
    ): Promise<{ items: GiftCardBatch[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where: Record<string, unknown> = { programId };
      if (filters.status) {
        where.status = filters.status;
      }

      const [items, total] = await Promise.all([
        db(tx).giftCardBatch.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        db(tx).giftCardBatch.count({ where }),
      ]);

      return { items, total };
    },

    async updateBatchStatus(
      id: string,
      status: string,
      extra?: { error?: string; generationJobId?: string },
      tx?: Tx,
    ): Promise<GiftCardBatch> {
      return db(tx).giftCardBatch.update({
        where: { id },
        data: { status: status as never, ...extra },
      });
    },

    async incrementGeneratedCount(id: string, count: number, tx?: Tx): Promise<void> {
      await db(tx).giftCardBatch.update({
        where: { id },
        data: { generatedCount: { increment: count } },
      });
    },

    async countRedeemedCardsInBatch(batchId: string, tx?: Tx): Promise<number> {
      return db(tx).giftCard.count({
        where: {
          batchId,
          status: { in: ["partially_redeemed", "depleted"] },
        },
      });
    },

    // ── Card operations ────────────────────

    async createCards(
      inputs: {
        code: string;
        batchId: string;
        initialAmount: number;
        balance: number;
        currency: string;
        expirationDate: Date;
      }[],
      tx?: Tx,
    ): Promise<number> {
      const result = await db(tx).giftCard.createMany({
        data: inputs,
        skipDuplicates: true,
      });
      return result.count;
    },

    async findCardByCode(code: string, tx?: Tx) {
      return db(tx).giftCard.findUnique({
        where: { code },
        include: { batch: { select: { programId: true } } },
      });
    },

    async findCardsByBatch(
      batchId: string,
      filters: { page?: number; pageSize?: number },
      tx?: Tx,
    ): Promise<{ items: GiftCard[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where = { batchId };

      const [items, total] = await Promise.all([
        db(tx).giftCard.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { code: "asc" },
        }),
        db(tx).giftCard.count({ where }),
      ]);

      return { items, total };
    },

    async updateCardBalance(
      id: string,
      amount: number,
      status: string,
      extra?: { activatedAt?: Date; lastRedemptionAt?: Date },
      tx?: Tx,
    ): Promise<GiftCard> {
      const result = await db(tx).giftCard.updateMany({
        where: { id, balance: { gte: amount } },
        data: {
          balance: { decrement: amount },
          status: status as never,
          ...extra,
        },
      });
      if (result.count === 0) {
        throw new GiftCardConcurrentUpdateError();
      }
      return db(tx).giftCard.findUniqueOrThrow({ where: { id } });
    },

    async restoreCardBalance(
      id: string,
      amount: number,
      status: string,
      tx?: Tx,
    ): Promise<GiftCard> {
      return db(tx).giftCard.update({
        where: { id },
        data: {
          balance: { increment: amount },
          status: status as never,
        },
      });
    },

    async updateCardStatus(
      id: string,
      status: string,
      extra?: { balance: number },
      tx?: Tx,
    ): Promise<GiftCard> {
      return db(tx).giftCard.update({
        where: { id },
        data: { status: status as never, ...extra },
      });
    },

    async findActiveExpired(now: Date, take = 1000, cursor?: string, tx?: Tx) {
      return db(tx).giftCard.findMany({
        where: {
          status: { in: ["active", "partially_redeemed"] },
          expirationDate: { lt: now },
        },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        include: { batch: { select: { programId: true } } },
      });
    },

    // ── Transaction operations ─────────────

    async createTransaction(
      input: {
        giftCardId: string;
        type: string;
        amount: number;
        balanceAfter: number;
        memberId?: string;
        idempotencyKey?: string;
        idempotencyPayloadHash?: string;
        programId: string;
        orderRef?: string;
        createdById?: string;
      },
      tx?: Tx,
    ): Promise<GiftCardTransaction> {
      return db(tx).giftCardTransaction.create({ data: input as never });
    },

    async findTransactionByIdempotencyKey(
      programId: string,
      key: string,
      tx?: Tx,
    ): Promise<GiftCardTransaction | null> {
      return db(tx).giftCardTransaction.findUnique({
        where: { programId_idempotencyKey: { programId, idempotencyKey: key } },
      });
    },

    async findTransactionsByCard(
      giftCardId: string,
      filters: { page?: number; pageSize?: number; type?: string },
      tx?: Tx,
    ): Promise<{ items: GiftCardTransaction[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where: Record<string, unknown> = { giftCardId };
      if (filters.type) {
        where.type = filters.type;
      }

      const [items, total] = await Promise.all([
        db(tx).giftCardTransaction.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        db(tx).giftCardTransaction.count({ where }),
      ]);

      return { items, total };
    },

    // ── Terms template operations ──────────

    async createTermsTemplate(input: CreateTermsTemplateInput, tx?: Tx): Promise<TermsTemplate> {
      return db(tx).termsTemplate.create({ data: input });
    },

    async findTermsTemplateById(id: string, tx?: Tx): Promise<TermsTemplate | null> {
      return db(tx).termsTemplate.findUnique({ where: { id } });
    },

    async findTermsTemplates(programId: string, tx?: Tx): Promise<TermsTemplate[]> {
      return db(tx).termsTemplate.findMany({
        where: { programId },
        orderBy: { name: "asc" },
      });
    },

    async updateTermsTemplate(
      id: string,
      input: UpdateTermsTemplateInput,
      tx?: Tx,
    ): Promise<TermsTemplate> {
      return db(tx).termsTemplate.update({ where: { id }, data: input });
    },

    async softDeleteTermsTemplate(id: string, tx?: Tx): Promise<void> {
      await db(tx).termsTemplate.update({
        where: { id },
        data: { isActive: false },
      });
    },

    // ── Metrics helpers ────────────────────

    async countCardsByStatus(
      programId: string,
    ): Promise<{ active: number; outstandingBalance: number }> {
      const activeStatuses = ["active", "partially_redeemed"];
      const cards = await prisma.giftCard.findMany({
        where: {
          batch: { programId },
          status: { in: activeStatuses as never },
        },
        select: { balance: true },
      });

      let outstandingBalance = 0;
      for (const card of cards) {
        outstandingBalance += Number(card.balance);
      }

      return { active: cards.length, outstandingBalance };
    },

    async sumOutstandingBalances(): Promise<
      { programId: string; currency: string; total: number }[]
    > {
      // Aggregate by (programId, currency) across all batches to avoid last-write-wins per batch
      const rows = await prisma.giftCard.findMany({
        where: {
          status: { in: ["active", "partially_redeemed"] as never },
        },
        select: { balance: true, currency: true, batch: { select: { programId: true } } },
      });

      const map = new Map<string, number>();
      for (const row of rows) {
        const key = `${row.batch.programId}|${row.currency}`;
        map.set(key, (map.get(key) ?? 0) + Number(row.balance));
      }

      return Array.from(map.entries()).map(([key, total]) => {
        const [programId = "", currency = ""] = key.split("|");
        return { programId, currency, total };
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

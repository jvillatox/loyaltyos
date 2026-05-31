import type {
  GiftCard,
  GiftCardBatch,
  GiftCardTransaction,
  PrismaClient,
  TermsTemplate,
} from "@prisma/client";

import type {
  CreateBatchInput,
  CreateTermsTemplateInput,
  UpdateTermsTemplateInput,
} from "./types.js";

export function createRepository(prisma: PrismaClient) {
  return {
    // ── Batch operations ──────────────────

    async createBatch(input: CreateBatchInput): Promise<GiftCardBatch> {
      return prisma.giftCardBatch.create({ data: input });
    },

    async findBatchById(id: string): Promise<GiftCardBatch | null> {
      return prisma.giftCardBatch.findUnique({
        where: { id },
        include: { giftCards: { select: { id: true } } },
      });
    },

    async findBatches(
      programId: string,
      filters: { status?: string; page?: number; pageSize?: number },
    ): Promise<{ items: GiftCardBatch[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where: Record<string, unknown> = { programId };
      if (filters.status) {
        where.status = filters.status;
      }

      const [items, total] = await Promise.all([
        prisma.giftCardBatch.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.giftCardBatch.count({ where }),
      ]);

      return { items, total };
    },

    async updateBatchStatus(
      id: string,
      status: string,
      extra?: { error?: string; generationJobId?: string },
    ): Promise<GiftCardBatch> {
      return prisma.giftCardBatch.update({
        where: { id },
        data: { status: status as never, ...extra },
      });
    },

    async incrementGeneratedCount(id: string, count: number): Promise<void> {
      await prisma.giftCardBatch.update({
        where: { id },
        data: { generatedCount: { increment: count } },
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
    ): Promise<number> {
      const result = await prisma.giftCard.createMany({
        data: inputs,
        skipDuplicates: true,
      });
      return result.count;
    },

    async findCardByCode(code: string) {
      return prisma.giftCard.findUnique({
        where: { code },
        include: { batch: { select: { programId: true } } },
      });
    },

    async findCardsByBatch(
      batchId: string,
      filters: { page?: number; pageSize?: number },
    ): Promise<{ items: GiftCard[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where = { batchId };

      const [items, total] = await Promise.all([
        prisma.giftCard.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { code: "asc" },
        }),
        prisma.giftCard.count({ where }),
      ]);

      return { items, total };
    },

    async updateCardBalance(
      id: string,
      amount: number,
      status: string,
      extra?: { activatedAt?: Date; lastRedemptionAt?: Date },
    ): Promise<GiftCard> {
      return prisma.giftCard.update({
        where: { id },
        data: {
          balance: { decrement: amount },
          status: status as never,
          ...extra,
        },
      });
    },

    async restoreCardBalance(id: string, amount: number, status: string): Promise<GiftCard> {
      return prisma.giftCard.update({
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
    ): Promise<GiftCard> {
      return prisma.giftCard.update({
        where: { id },
        data: { status: status as never, ...extra },
      });
    },

    async findActiveExpired(now: Date): Promise<GiftCard[]> {
      return prisma.giftCard.findMany({
        where: {
          status: { in: ["active", "partially_redeemed"] },
          expirationDate: { lt: now },
        },
      });
    },

    // ── Transaction operations ─────────────

    async createTransaction(input: {
      giftCardId: string;
      type: string;
      amount: number;
      balanceAfter: number;
      memberId?: string;
      idempotencyKey?: string;
      orderRef?: string;
    }): Promise<GiftCardTransaction> {
      return prisma.giftCardTransaction.create({ data: input as never });
    },

    async findTransactionByIdempotencyKey(key: string): Promise<GiftCardTransaction | null> {
      return prisma.giftCardTransaction.findUnique({
        where: { idempotencyKey: key },
      });
    },

    async findTransactionsByCard(
      giftCardId: string,
      filters: { page?: number; pageSize?: number; type?: string },
    ): Promise<{ items: GiftCardTransaction[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where: Record<string, unknown> = { giftCardId };
      if (filters.type) {
        where.type = filters.type;
      }

      const [items, total] = await Promise.all([
        prisma.giftCardTransaction.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.giftCardTransaction.count({ where }),
      ]);

      return { items, total };
    },

    // ── Terms template operations ──────────

    async createTermsTemplate(input: CreateTermsTemplateInput): Promise<TermsTemplate> {
      return prisma.termsTemplate.create({ data: input });
    },

    async findTermsTemplateById(id: string): Promise<TermsTemplate | null> {
      return prisma.termsTemplate.findUnique({ where: { id } });
    },

    async findTermsTemplates(programId: string): Promise<TermsTemplate[]> {
      return prisma.termsTemplate.findMany({
        where: { programId },
        orderBy: { name: "asc" },
      });
    },

    async updateTermsTemplate(id: string, input: UpdateTermsTemplateInput): Promise<TermsTemplate> {
      return prisma.termsTemplate.update({ where: { id }, data: input });
    },

    async softDeleteTermsTemplate(id: string): Promise<void> {
      await prisma.termsTemplate.update({
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
  };
}

export type Repository = ReturnType<typeof createRepository>;

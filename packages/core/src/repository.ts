import type { Prisma, PrismaClient } from "@prisma/client";

import type { PaginatedResult, PaginationParams } from "./types.js";

export function createRepository(prisma: PrismaClient) {
  return {
    async findAccount(memberId: string, programId: string) {
      return prisma.pointAccount.findFirst({
        where: { memberId, programId },
      });
    },

    async createAccount(memberId: string, programId: string) {
      return prisma.pointAccount.create({
        data: { memberId, programId },
      });
    },

    async findOrCreateAccount(memberId: string, programId: string) {
      const existing = await prisma.pointAccount.findFirst({
        where: { memberId, programId },
      });
      if (existing) return existing;
      return prisma.pointAccount.create({
        data: { memberId, programId },
      });
    },

    async findTxByIdempotencyKey(idempotencyKey: string) {
      return prisma.pointTransaction.findUnique({
        where: { idempotencyKey },
      });
    },

    async findTxById(txId: string) {
      return prisma.pointTransaction.findUnique({
        where: { id: txId },
      });
    },

    createTx(input: {
      accountId: string;
      type: Prisma.PointTransactionCreateInput["type"];
      amount: number;
      balanceAfter: number;
      source: string;
      idempotencyKey: string;
      description?: string;
      metadata?: Prisma.InputJsonValue;
      expiresAt?: Date;
    }) {
      return prisma.pointTransaction.create({ data: input });
    },

    updateBalance(accountId: string, balance: number, pendingBalance?: number) {
      const data: Prisma.PointAccountUpdateInput = { balance };
      if (pendingBalance !== undefined) {
        data.pendingBalance = pendingBalance;
      }
      return prisma.pointAccount.update({
        where: { id: accountId },
        data,
      });
    },

    incrementBalance(accountId: string, amount: number) {
      return prisma.pointAccount.update({
        where: { id: accountId },
        data: {
          balance: { increment: amount },
          totalEarned: amount > 0 ? { increment: amount } : undefined,
          totalRedeemed: amount < 0 ? { increment: Math.abs(amount) } : undefined,
        },
      });
    },

    async findActiveRules(programId: string, eventType: string) {
      return prisma.pointRule.findMany({
        where: {
          programId,
          eventType,
          isActive: true,
          OR: [
            { startsAt: null, endsAt: null },
            { startsAt: { lte: new Date() }, endsAt: null },
            { startsAt: null, endsAt: { gte: new Date() } },
            { startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
          ],
        },
      });
    },

    findExpiredTransactions(programId: string, now: Date) {
      return prisma.pointTransaction.findMany({
        where: {
          account: { programId },
          type: "EARN",
          expiresAt: { lte: now },
          // Not already expired or reversed
          AND: {
            reversedById: null,
          },
        },
        include: { account: true },
      });
    },

    async findReversalForTx(txId: string) {
      return prisma.pointTransaction.findFirst({
        where: { reversedFromId: txId },
      });
    },

    async findHistory(
      accountId: string,
      pagination: PaginationParams = {},
    ): Promise<PaginatedResult<unknown>> {
      const page = pagination.page ?? 1;
      const pageSize = pagination.pageSize ?? 20;
      const [items, total] = await Promise.all([
        prisma.pointTransaction.findMany({
          where: { accountId },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.pointTransaction.count({ where: { accountId } }),
      ]);
      return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

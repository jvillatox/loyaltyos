import type { Prisma, PrismaClient } from "@prisma/client";

import { deriveOrganizationId } from "./tenancy.js";
import type { PaginatedResult, PaginationParams } from "./types.js";

export function createRepository(prisma: PrismaClient) {
  return {
    async findAccount(memberId: string, programId: string) {
      return prisma.pointAccount.findFirst({
        where: { memberId, programId },
      });
    },

    async findProgramHoldDays(programId: string) {
      const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { holdDays: true },
      });
      return program?.holdDays ?? null;
    },

    async findProgramExpiry(programId: string) {
      return prisma.program.findUnique({
        where: { id: programId },
        select: { expiryMode: true, expiryMonths: true, expiryChangedAt: true },
      });
    },

    async findNextAvailableAt(accountId: string) {
      return prisma.pointTransaction.findFirst({
        where: {
          accountId,
          type: "EARN",
          settledAt: null,
          reversedById: null,
          availableAt: { not: null },
        },
        orderBy: { availableAt: "asc" },
        select: { availableAt: true },
      });
    },

    async createAccount(memberId: string, programId: string) {
      const organizationId = await deriveOrganizationId(prisma, programId);
      return prisma.pointAccount.create({
        data: { memberId, programId, organizationId },
      });
    },

    async findOrCreateAccount(memberId: string, programId: string) {
      const existing = await prisma.pointAccount.findFirst({
        where: { memberId, programId },
      });
      if (existing) return existing;
      const organizationId = await deriveOrganizationId(prisma, programId);
      return prisma.pointAccount.create({
        data: { memberId, programId, organizationId },
      });
    },

    async findTxByIdempotencyKey(programId: string, idempotencyKey: string) {
      return prisma.pointTransaction.findUnique({
        where: { programId_idempotencyKey: { programId, idempotencyKey } },
      });
    },

    async findTxById(txId: string) {
      return prisma.pointTransaction.findUnique({
        where: { id: txId },
      });
    },

    async createTx(input: {
      accountId: string;
      programId: string;
      type: Prisma.PointTransactionCreateInput["type"];
      amount: number;
      balanceAfter: number;
      source: string;
      idempotencyKey: string;
      description?: string;
      metadata?: Prisma.InputJsonValue;
    }) {
      const organizationId = await deriveOrganizationId(prisma, input.programId);
      return prisma.pointTransaction.create({ data: { ...input, organizationId } });
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

    findExpiredLots(programId: string, now: Date) {
      return prisma.pointLot.findMany({
        where: {
          account: { programId },
          remaining: { gt: 0 },
          expiresAt: { lte: now },
        },
        orderBy: { expiresAt: "asc" },
      });
    },

    findActiveAccounts(programId: string) {
      return prisma.pointAccount.findMany({
        where: { programId, balance: { gt: 0 } },
        select: { id: true, memberId: true, balance: true, lastActivityAt: true },
      });
    },

    findUpcomingExpiringLots(programId: string, from: Date, to: Date) {
      return prisma.pointLot.findMany({
        where: {
          programId,
          remaining: { gt: 0 },
          expiresAt: { gt: from, lte: to },
        },
        select: {
          account: { select: { memberId: true } },
          expiresAt: true,
          remaining: true,
        },
        orderBy: { expiresAt: "asc" },
      });
    },

    findNextExpiringLot(accountId: string) {
      return prisma.pointLot.findFirst({
        where: { accountId, remaining: { gt: 0 }, expiresAt: { not: null } },
        orderBy: { expiresAt: "asc" },
      });
    },

    findLotsExpiringAt(accountId: string, expiresAt: Date) {
      return prisma.pointLot.findMany({
        where: { accountId, remaining: { gt: 0 }, expiresAt },
      });
    },

    findLotsWithoutExpiry(programId: string) {
      return prisma.pointLot.findMany({
        where: { programId, remaining: { gt: 0 }, expiresAt: null },
        select: { id: true, createdAt: true },
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

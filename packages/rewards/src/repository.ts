import type { Prisma, PrismaClient } from "@prisma/client";

import type { RewardCreateInput, RewardUpdateInput, RewardWithRedemptions } from "./types.js";

export function createRepository(prisma: PrismaClient) {
  return {
    async create(input: RewardCreateInput) {
      return prisma.reward.create({ data: input });
    },

    async update(id: string, input: RewardUpdateInput) {
      return prisma.reward.update({ where: { id }, data: input });
    },

    async softDelete(id: string): Promise<void> {
      await prisma.reward.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    },

    async publish(id: string) {
      return prisma.reward.update({
        where: { id },
        data: { isActive: true },
      });
    },

    async findById(id: string): Promise<RewardWithRedemptions | null> {
      return prisma.reward.findFirst({
        where: { id, deletedAt: null },
        include: {
          redemptions: { select: { id: true, memberId: true } },
        },
      }) as Promise<RewardWithRedemptions | null>;
    },

    async findMany(
      programId: string,
      filters: {
        category?: string;
        isActive?: boolean;
        minPoints?: number;
        maxPoints?: number;
        tierRequired?: string;
        page?: number;
        pageSize?: number;
      },
    ): Promise<{ items: RewardWithRedemptions[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where: Prisma.RewardWhereInput = {
        programId,
        deletedAt: null,
      };

      if (filters.isActive !== undefined) {
        where.isActive = filters.isActive;
      }

      if (filters.category) {
        where.category = filters.category;
      }

      if (filters.minPoints !== undefined || filters.maxPoints !== undefined) {
        where.pointsCost = {};
        if (filters.minPoints !== undefined) {
          (where.pointsCost as Prisma.IntFilter).gte = filters.minPoints;
        }
        if (filters.maxPoints !== undefined) {
          (where.pointsCost as Prisma.IntFilter).lte = filters.maxPoints;
        }
      }

      if (filters.tierRequired) {
        where.tierRequired = filters.tierRequired;
      }

      const [items, total] = await Promise.all([
        prisma.reward.findMany({
          where,
          include: {
            redemptions: { select: { id: true, memberId: true } },
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.reward.count({ where }),
      ]);

      return { items: items as RewardWithRedemptions[], total };
    },

    async decrementStock(id: string): Promise<{ id: string; stock: number | null } | null> {
      try {
        return await prisma.reward.update({
          where: { id, stock: { gt: 0 } },
          data: { stock: { decrement: 1 } },
          select: { id: true, stock: true },
        });
      } catch {
        return null;
      }
    },

    async incrementStock(id: string, qty: number) {
      return prisma.reward.update({
        where: { id },
        data: { stock: { increment: qty } },
      });
    },

    async recordRedemption(
      rewardId: string,
      memberId: string,
      pointsSpent: number,
      metadata?: Prisma.InputJsonValue,
    ) {
      return prisma.rewardRedemption.create({
        data: { rewardId, memberId, pointsSpent, metadata },
      });
    },

    async deleteRedemption(id: string): Promise<void> {
      await prisma.rewardRedemption.delete({ where: { id } });
    },

    async findRedemptionByIdempotencyKey(rewardId: string, idempotencyKey: string) {
      return prisma.rewardRedemption.findFirst({
        where: {
          rewardId,
          metadata: {
            path: ["idempotencyKey"],
            equals: idempotencyKey,
          },
        },
      });
    },

    async findMemberActiveTier(memberId: string) {
      return prisma.memberTier.findFirst({
        where: { memberId, downgradedAt: null },
        include: { tier: true },
        orderBy: { tier: { rank: "desc" } },
      });
    },

    async findTierByName(programId: string, name: string) {
      return prisma.tier.findFirst({
        where: { programId, name },
      });
    },

    async findMemberBalance(memberId: string, programId: string) {
      return prisma.pointAccount.findFirst({
        where: { memberId, programId },
        select: { balance: true },
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

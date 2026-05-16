import type { Coupon, PrismaClient } from "@prisma/client";

import type { CouponCreateInput, CouponUpdateInput, CouponWithRedemptions } from "./types.js";

export function createRepository(prisma: PrismaClient) {
  return {
    async create(input: CouponCreateInput): Promise<Coupon> {
      return prisma.coupon.create({ data: input });
    },

    async createMany(inputs: CouponCreateInput[]): Promise<number> {
      const result = await prisma.coupon.createMany({ data: inputs });
      return result.count;
    },

    async update(id: string, input: CouponUpdateInput): Promise<Coupon> {
      return prisma.coupon.update({ where: { id }, data: input });
    },

    async softDelete(id: string): Promise<void> {
      await prisma.coupon.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    },

    async findById(id: string): Promise<CouponWithRedemptions | null> {
      return (await prisma.coupon.findFirst({
        where: { id, deletedAt: null },
        include: { redemptions: { select: { id: true, memberId: true } } },
      })) as CouponWithRedemptions | null;
    },

    async findByCode(programId: string, code: string): Promise<CouponWithRedemptions | null> {
      return (await prisma.coupon.findFirst({
        where: { programId, code, deletedAt: null },
        include: { redemptions: { select: { id: true, memberId: true } } },
      })) as CouponWithRedemptions | null;
    },

    async findByCodeGlobal(code: string): Promise<CouponWithRedemptions | null> {
      return (await prisma.coupon.findFirst({
        where: { code, deletedAt: null },
        include: { redemptions: { select: { id: true, memberId: true } } },
      })) as CouponWithRedemptions | null;
    },

    async findMany(
      programId: string,
      filters: { isActive?: boolean; mode?: string; page?: number; pageSize?: number },
    ): Promise<{ items: Coupon[]; total: number }> {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const where: Record<string, unknown> = {
        programId,
        deletedAt: null,
      };

      if (filters.isActive === true) {
        where.OR = [
          { startsAt: null, expiresAt: null },
          { startsAt: { lte: new Date() }, expiresAt: null },
          { startsAt: null, expiresAt: { gte: new Date() } },
          { startsAt: { lte: new Date() }, expiresAt: { gte: new Date() } },
        ];
      }

      if (filters.mode) {
        where.mode = filters.mode;
      }

      const [items, total] = await Promise.all([
        prisma.coupon.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.coupon.count({ where }),
      ]);

      return { items, total };
    },

    async recordRedemption(couponId: string, memberId: string): Promise<string> {
      const redemption = await prisma.couponRedemption.create({
        data: { couponId, memberId },
      });
      return redemption.id;
    },

    async incrementUsedCount(couponId: string): Promise<void> {
      await prisma.coupon.update({
        where: { id: couponId },
        data: { usedCount: { increment: 1 } },
      });
    },

    async countMemberRedemptions(couponId: string, memberId: string): Promise<number> {
      return prisma.couponRedemption.count({
        where: { couponId, memberId },
      });
    },

    async checkCodeExists(programId: string, code: string): Promise<boolean> {
      const existing = await prisma.coupon.findFirst({
        where: { programId, code },
        select: { id: true },
      });
      return existing !== null;
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

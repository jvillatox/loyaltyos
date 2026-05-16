import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  MemberWithComputedFields,
  SegmentCreateInput,
  SegmentListFilters,
  SegmentRow,
  SegmentUpdateInput,
} from "./types.js";

interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export function createRepository(prisma: PrismaClient) {
  return {
    async createSegment(data: SegmentCreateInput): Promise<SegmentRow> {
      return prisma.segment.create({
        data: {
          programId: data.programId,
          name: data.name,
          description: data.description,
          type: data.type,
          rules: data.rules as Prisma.InputJsonValue,
          memberIds: data.memberIds ?? [],
        },
      });
    },

    async updateSegment(id: string, data: SegmentUpdateInput): Promise<SegmentRow> {
      return prisma.segment.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && {
            description: data.description,
          }),
          ...(data.rules !== undefined && {
            rules: data.rules as Prisma.InputJsonValue,
          }),
          ...(data.memberIds !== undefined && { memberIds: data.memberIds }),
        },
      });
    },

    async findById(id: string): Promise<SegmentRow | null> {
      return prisma.segment.findFirst({
        where: { id },
      });
    },

    async findMany(
      programId: string,
      filters: SegmentListFilters = {},
    ): Promise<{ items: SegmentRow[]; total: number }> {
      const where: Prisma.SegmentWhereInput = { programId };

      if (filters.type) where.type = filters.type;
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      if (filters.search) {
        where.name = { contains: filters.search, mode: "insensitive" };
      }

      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const [items, total] = await Promise.all([
        prisma.segment.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.segment.count({ where }),
      ]);

      return { items, total };
    },

    async addMemberIds(id: string, memberIds: string[]): Promise<SegmentRow> {
      return prisma.segment.update({
        where: { id },
        data: { memberIds: { push: memberIds } },
      });
    },

    async removeMemberIds(
      id: string,
      existingIds: string[],
      toRemove: string[],
    ): Promise<SegmentRow> {
      const removeSet = new Set(toRemove);
      const filtered = existingIds.filter((mid) => !removeSet.has(mid));
      return prisma.segment.update({
        where: { id },
        data: { memberIds: filtered },
      });
    },

    async findMemberWithAccountAndTiers(
      memberId: string,
    ): Promise<MemberWithComputedFields | null> {
      const [member, account, memberTiers] = await Promise.all([
        prisma.member.findFirst({ where: { id: memberId } }),
        prisma.pointAccount.findFirst({ where: { memberId } }),
        prisma.memberTier.findMany({
          where: { memberId, downgradedAt: null },
          include: { tier: true },
        }),
      ]);

      if (!member) return null;

      const currentTier = memberTiers.length > 0 ? (memberTiers[0]?.tier?.name ?? null) : null;
      const totalSpent = account ? account.totalEarned - account.totalRedeemed : 0;

      return {
        id: member.id,
        programId: member.programId,
        email: member.email,
        phone: member.phone,
        firstName: member.firstName,
        lastName: member.lastName,
        metadata: member.metadata as Record<string, unknown> | null,
        tags: member.tags,
        joinedAt: member.joinedAt,
        deletedAt: member.deletedAt,
        totalSpent,
        currentTier,
      };
    },

    async findMembersWithAccounts(programId: string): Promise<MemberWithComputedFields[]> {
      const members = await prisma.member.findMany({
        where: { programId, deletedAt: null },
        include: {
          pointAccount: true,
          memberTiers: {
            where: { downgradedAt: null },
            include: { tier: true },
          },
        },
      });

      return members.map((m) => ({
        id: m.id,
        programId: m.programId,
        email: m.email,
        phone: m.phone,
        firstName: m.firstName,
        lastName: m.lastName,
        metadata: m.metadata as Record<string, unknown> | null,
        tags: m.tags,
        joinedAt: m.joinedAt,
        deletedAt: m.deletedAt,
        totalSpent: m.pointAccount ? m.pointAccount.totalEarned - m.pointAccount.totalRedeemed : 0,
        currentTier: m.memberTiers.length > 0 ? (m.memberTiers[0]?.tier?.name ?? null) : null,
      }));
    },

    async findMembersByIds(
      ids: string[],
      pagination?: PaginationParams,
    ): Promise<{ items: MemberWithComputedFields[]; total: number }> {
      const page = pagination?.page ?? 1;
      const pageSize = pagination?.pageSize ?? 20;

      const where: Prisma.MemberWhereInput = { id: { in: ids }, deletedAt: null };

      const [items, total] = await Promise.all([
        prisma.member.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            pointAccount: true,
            memberTiers: {
              where: { downgradedAt: null },
              include: { tier: true },
            },
          },
        }),
        prisma.member.count({ where }),
      ]);

      return {
        items: items.map((m) => ({
          id: m.id,
          programId: m.programId,
          email: m.email,
          phone: m.phone,
          firstName: m.firstName,
          lastName: m.lastName,
          metadata: m.metadata as Record<string, unknown> | null,
          tags: m.tags,
          joinedAt: m.joinedAt,
          deletedAt: m.deletedAt,
          totalSpent: m.pointAccount
            ? m.pointAccount.totalEarned - m.pointAccount.totalRedeemed
            : 0,
          currentTier: m.memberTiers.length > 0 ? (m.memberTiers[0]?.tier?.name ?? null) : null,
        })),
        total,
      };
    },

    async findMembersByWhere(
      where: Prisma.MemberWhereInput,
      pagination?: PaginationParams,
    ): Promise<{ items: MemberWithComputedFields[]; total: number }> {
      const page = pagination?.page ?? 1;
      const pageSize = pagination?.pageSize ?? 20;

      const fullWhere: Prisma.MemberWhereInput = {
        ...where,
        deletedAt: null,
      };

      const [items, total] = await Promise.all([
        prisma.member.findMany({
          where: fullWhere,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            pointAccount: true,
            memberTiers: {
              where: { downgradedAt: null },
              include: { tier: true },
            },
          },
        }),
        prisma.member.count({ where: fullWhere }),
      ]);

      return {
        items: items.map((m) => ({
          id: m.id,
          programId: m.programId,
          email: m.email,
          phone: m.phone,
          firstName: m.firstName,
          lastName: m.lastName,
          metadata: m.metadata as Record<string, unknown> | null,
          tags: m.tags,
          joinedAt: m.joinedAt,
          deletedAt: m.deletedAt,
          totalSpent: m.pointAccount
            ? m.pointAccount.totalEarned - m.pointAccount.totalRedeemed
            : 0,
          currentTier: m.memberTiers.length > 0 ? (m.memberTiers[0]?.tier?.name ?? null) : null,
        })),
        total,
      };
    },

    async countMembersByWhere(where: Prisma.MemberWhereInput): Promise<number> {
      return prisma.member.count({
        where: { ...where, deletedAt: null },
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

import type { BadgeType, Prisma, PrismaClient } from "@prisma/client";

import type {
  BadgeCreateInput,
  BadgeListFilters,
  BadgeRow,
  MemberAggregate,
  TierCreateInput,
  TierRow,
  TierUpdateInput,
} from "./types.js";

export function createRepository(prisma: PrismaClient) {
  return {
    // ═══════════════════════════════════════════════════════════════════
    // BADGES CRUD
    // ═══════════════════════════════════════════════════════════════════

    async createBadge(data: BadgeCreateInput): Promise<BadgeRow> {
      return prisma.badge.create({
        data: {
          programId: data.programId,
          name: data.name,
          description: data.description,
          type: data.type as BadgeType,
          imageUrl: data.imageUrl,
          tierId: data.tierId,
          conditions: data.conditions as Prisma.InputJsonValue,
          seriesId: data.seriesId,
          seriesPosition: data.seriesPosition,
        },
      });
    },

    async updateBadge(
      id: string,
      data: Partial<BadgeCreateInput & { isActive: boolean }>,
    ): Promise<BadgeRow> {
      return prisma.badge.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.type !== undefined && { type: data.type as BadgeType }),
          ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
          ...(data.tierId !== undefined && { tierId: data.tierId }),
          ...(data.conditions !== undefined && {
            conditions: data.conditions as Prisma.InputJsonValue,
          }),
          ...(data.seriesId !== undefined && { seriesId: data.seriesId }),
          ...(data.seriesPosition !== undefined && { seriesPosition: data.seriesPosition }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
    },

    async findBadgeById(id: string): Promise<BadgeRow | null> {
      return prisma.badge.findFirst({ where: { id } });
    },

    async findBadgesByProgram(
      programId: string,
      filters: BadgeListFilters = {},
    ): Promise<{ items: BadgeRow[]; total: number }> {
      const where: Prisma.BadgeWhereInput = { programId };

      if (filters.type) where.type = filters.type as BadgeType;
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      if (filters.search) {
        where.name = { contains: filters.search, mode: "insensitive" };
      }

      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const [items, total] = await Promise.all([
        prisma.badge.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.badge.count({ where }),
      ]);

      return { items, total };
    },

    async findAllActiveBadges(programId: string): Promise<BadgeRow[]> {
      return prisma.badge.findMany({
        where: { programId, isActive: true },
      });
    },

    // ═══════════════════════════════════════════════════════════════════
    // TIERS CRUD
    // ═══════════════════════════════════════════════════════════════════

    async createTier(data: TierCreateInput): Promise<TierRow> {
      return prisma.tier.create({
        data: {
          programId: data.programId,
          name: data.name,
          rank: data.rank,
          minPoints: data.minPoints,
          color: data.color,
          iconUrl: data.iconUrl,
          benefits: data.benefits as Prisma.InputJsonValue,
        },
      });
    },

    async updateTier(id: string, data: TierUpdateInput): Promise<TierRow> {
      return prisma.tier.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.rank !== undefined && { rank: data.rank }),
          ...(data.minPoints !== undefined && { minPoints: data.minPoints }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.iconUrl !== undefined && { iconUrl: data.iconUrl }),
          ...(data.benefits !== undefined && { benefits: data.benefits as Prisma.InputJsonValue }),
        },
      });
    },

    async findTierById(id: string): Promise<TierRow | null> {
      return prisma.tier.findFirst({ where: { id } });
    },

    async findTiersByProgram(programId: string): Promise<TierRow[]> {
      return prisma.tier.findMany({
        where: { programId },
        orderBy: { rank: "asc" },
      });
    },

    async findTierByRank(programId: string, rank: number): Promise<TierRow | null> {
      return prisma.tier.findFirst({
        where: { programId, rank },
      });
    },

    async deleteTier(id: string): Promise<void> {
      await prisma.tier.delete({ where: { id } });
    },

    // ═══════════════════════════════════════════════════════════════════
    // MEMBER AGGREGATES
    // ═══════════════════════════════════════════════════════════════════

    async findMemberAggregate(memberId: string): Promise<MemberAggregate | null> {
      const member = await prisma.member.findFirst({
        where: { id: memberId, deletedAt: null },
        include: {
          pointAccount: true,
          memberTiers: {
            where: { downgradedAt: null },
            include: { tier: true },
          },
        },
      });

      if (!member) return null;

      // Count events by type for badge evaluation
      const events = await prisma.event.findMany({
        where: { memberId, processed: true },
        select: { type: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      const eventCounts: Record<string, number> = {};
      let lastEventAt: Date | null = null;
      for (const e of events) {
        eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
        if (!lastEventAt || e.createdAt > lastEventAt) {
          lastEventAt = e.createdAt;
        }
      }

      const currentTier = member.memberTiers.length > 0 ? member.memberTiers[0] : null;
      const totalEarned = member.pointAccount?.totalEarned ?? 0;
      const totalRedeemed = member.pointAccount?.totalRedeemed ?? 0;

      return {
        id: member.id,
        programId: member.programId,
        email: member.email,
        phone: member.phone,
        firstName: member.firstName,
        lastName: member.lastName,
        tags: member.tags,
        joinedAt: member.joinedAt,
        deletedAt: member.deletedAt,
        totalEarned,
        totalRedeemed,
        currentBalance: member.pointAccount?.balance ?? 0,
        currentTier: currentTier?.tier.name ?? null,
        currentTierId: currentTier?.tierId ?? null,
        currentTierRank: currentTier?.tier.rank ?? null,
        eventCounts,
        totalSpent: totalEarned, // totalSpent = totalEarned for tier qualification
        lastEventAt,
      };
    },

    // ═══════════════════════════════════════════════════════════════════
    // MEMBER BADGE
    // ═══════════════════════════════════════════════════════════════════

    async findMemberBadge(memberId: string, badgeId: string) {
      return prisma.memberBadge.findUnique({
        where: { memberId_badgeId: { memberId, badgeId } },
        include: { badge: true },
      });
    },

    async upsertMemberBadge(
      memberId: string,
      badgeId: string,
      data: { progress?: number; unlockedAt?: Date | null; notifiedAt?: Date | null },
    ) {
      return prisma.memberBadge.upsert({
        where: { memberId_badgeId: { memberId, badgeId } },
        create: {
          memberId,
          badgeId,
          progress: data.progress ?? 0,
          unlockedAt: data.unlockedAt,
          notifiedAt: data.notifiedAt,
        },
        update: {
          ...(data.progress !== undefined && { progress: data.progress }),
          ...(data.unlockedAt !== undefined && { unlockedAt: data.unlockedAt }),
          ...(data.notifiedAt !== undefined && { notifiedAt: data.notifiedAt }),
        },
        include: { badge: true },
      });
    },

    async findMemberBadgesByMember(memberId: string, includeBadge = true) {
      return prisma.memberBadge.findMany({
        where: { memberId },
        include: includeBadge ? { badge: true } : undefined,
        orderBy: { unlockedAt: "desc" },
      });
    },

    async findUnlockedBadgeIds(memberId: string): Promise<Set<string>> {
      const rows = await prisma.memberBadge.findMany({
        where: { memberId, unlockedAt: { not: null } },
        select: { badgeId: true },
      });
      return new Set(rows.map((r: { badgeId: string }) => r.badgeId));
    },

    // ═══════════════════════════════════════════════════════════════════
    // MEMBER TIER
    // ═══════════════════════════════════════════════════════════════════

    async findCurrentTier(memberId: string) {
      return prisma.memberTier.findFirst({
        where: { memberId, downgradedAt: null },
        include: { tier: true },
      });
    },

    async createMemberTier(memberId: string, tierId: string) {
      return prisma.memberTier.create({
        data: { memberId, tierId },
        include: { tier: true },
      });
    },

    async downgradeMemberTier(memberId: string) {
      const current = await prisma.memberTier.findFirst({
        where: { memberId, downgradedAt: null },
      });
      if (current) {
        await prisma.memberTier.update({
          where: { id: current.id },
          data: { downgradedAt: new Date() },
        });
      }
      return current;
    },

    async findMemberTierHistory(memberId: string) {
      return prisma.memberTier.findMany({
        where: { memberId },
        include: { tier: true },
        orderBy: { upgradedAt: "desc" },
      });
    },

    // ═══════════════════════════════════════════════════════════════════
    // STATS
    // ═══════════════════════════════════════════════════════════════════

    async countMembersByTier(
      programId: string,
    ): Promise<{ tierId: string; tierName: string; rank: number; memberCount: number }[]> {
      const tiers = await prisma.tier.findMany({
        where: { programId },
        include: {
          memberTiers: {
            where: { downgradedAt: null },
            select: { id: true },
          },
        },
        orderBy: { rank: "asc" },
      });

      return tiers.map(
        (t: { id: string; name: string; rank: number; memberTiers: { id: string }[] }) => ({
          tierId: t.id,
          tierName: t.name,
          rank: t.rank,
          memberCount: t.memberTiers.length,
        }),
      );
    },

    async countMembersByBadge(programId: string): Promise<
      {
        badgeId: string;
        badgeName: string;
        type: string;
        unlockedCount: number;
        totalProgress: number;
      }[]
    > {
      const badges = await prisma.badge.findMany({
        where: { programId },
        include: {
          memberBadges: {
            select: { unlockedAt: true, progress: true },
          },
        },
      });

      return badges.map(
        (b: {
          id: string;
          name: string;
          type: string;
          memberBadges: { unlockedAt: Date | null; progress: number }[];
        }) => {
          const totalMemberBadges = b.memberBadges.length;
          const unlocked = b.memberBadges.filter(
            (mb: { unlockedAt: Date | null }) => mb.unlockedAt !== null,
          ).length;
          const totalProg =
            totalMemberBadges > 0
              ? b.memberBadges.reduce(
                  (sum: number, mb: { progress: number }) => sum + mb.progress,
                  0,
                ) / totalMemberBadges
              : 0;

          return {
            badgeId: b.id,
            badgeName: b.name,
            type: b.type,
            unlockedCount: unlocked,
            totalProgress: Math.round(totalProg * 100) / 100,
          };
        },
      );
    },

    async findMembersByProgram(programId: string): Promise<{ id: string; totalEarned: number }[]> {
      const members = await prisma.member.findMany({
        where: { programId, deletedAt: null },
        select: {
          id: true,
          pointAccount: { select: { totalEarned: true } },
        },
      });

      return members.map((m: { id: string; pointAccount: { totalEarned: number } | null }) => ({
        id: m.id,
        totalEarned: m.pointAccount?.totalEarned ?? 0,
      }));
    },

    async findRecentEvents(memberId: string, since: Date) {
      return prisma.event.findMany({
        where: {
          memberId,
          processed: true,
          createdAt: { gte: since },
        },
        select: { type: true, createdAt: true, payload: true },
        orderBy: { createdAt: "desc" },
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

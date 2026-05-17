import type { PrismaClient } from "@prisma/client";

import { computeProgress } from "./badge-conditions.js";
import type { Repository } from "./repository.js";
import { createRepository } from "./repository.js";
import type {
  BadgeCreateInput,
  BadgeEvaluation,
  BadgeListFilters,
  BadgeProgress,
  BadgeRow,
  BadgeUpdateInput,
} from "./types.js";
import { BadgeAlreadyAwardedError, BadgeNotFoundError } from "./types.js";

export interface BadgeEvent {
  type: string;
  memberId: string;
  programId: string;
  amount?: number;
  payload?: unknown;
}

export class BadgesService {
  private repo: Repository;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN CRUD
  // ═══════════════════════════════════════════════════════════════════

  async create(input: BadgeCreateInput): Promise<BadgeRow> {
    return this.repo.createBadge(input);
  }

  async update(id: string, input: BadgeUpdateInput): Promise<BadgeRow> {
    const badge = await this.repo.findBadgeById(id);
    if (!badge) throw new BadgeNotFoundError(id);
    return this.repo.updateBadge(id, input);
  }

  async delete(id: string): Promise<void> {
    const badge = await this.repo.findBadgeById(id);
    if (!badge) throw new BadgeNotFoundError(id);
    await this.repo.updateBadge(id, { isActive: false });
  }

  async getById(id: string): Promise<BadgeRow> {
    const badge = await this.repo.findBadgeById(id);
    if (!badge) throw new BadgeNotFoundError(id);
    return badge;
  }

  async list(
    programId: string,
    filters: BadgeListFilters = {},
  ): Promise<{
    items: BadgeRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const { items, total } = await this.repo.findBadgesByProgram(programId, filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVALUATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Re-evaluate all active badges for a member.
   * Returns which badges were just unlocked and progress for all.
   */
  async evaluateForMember(memberId: string, programId: string): Promise<BadgeEvaluation> {
    const aggregate = await this.repo.findMemberAggregate(memberId);
    if (!aggregate) {
      return { unlocked: [], progress: [] };
    }

    const badges = await this.repo.findAllActiveBadges(programId);
    const unlockedIds = await this.repo.findUnlockedBadgeIds(memberId);
    const recentEvents = await this.repo.findRecentEvents(
      memberId,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    );

    const unlocked: BadgeRow[] = [];
    const progress: BadgeProgress[] = [];

    for (const badge of badges) {
      const alreadyUnlocked = unlockedIds.has(badge.id);
      const prog = computeProgress(badge, aggregate, recentEvents, alreadyUnlocked);

      const bp: BadgeProgress = {
        badge,
        memberId,
        progress: prog.progress,
        currentValue: prog.currentValue,
        targetValue: prog.targetValue,
        unlocked: alreadyUnlocked || prog.met,
        unlockedAt: null,
        remainingCount: prog.remainingCount,
      };

      progress.push(bp);

      // Update MemberBadge row
      if (!alreadyUnlocked && prog.met) {
        const mb = await this.repo.upsertMemberBadge(memberId, badge.id, {
          progress: 100,
          unlockedAt: new Date(),
        });
        bp.unlocked = true;
        bp.unlockedAt = mb.unlockedAt;
        bp.progress = 100;
        unlocked.push(badge);
      } else if (!alreadyUnlocked) {
        await this.repo.upsertMemberBadge(memberId, badge.id, {
          progress: prog.progress,
        });
      }
    }

    return { unlocked, progress };
  }

  /**
   * Efficiently evaluate badges relevant to a specific event type.
   * Called from the events pipeline.
   */
  async evaluateOnEvent(event: BadgeEvent): Promise<BadgeEvaluation> {
    const aggregate = await this.repo.findMemberAggregate(event.memberId);
    if (!aggregate) {
      return { unlocked: [], progress: [] };
    }

    const badges = await this.repo.findAllActiveBadges(event.programId);
    const unlockedIds = await this.repo.findUnlockedBadgeIds(event.memberId);
    const recentEvents = await this.repo.findRecentEvents(
      event.memberId,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    );

    // Add the current event to the recent events list for evaluation
    const allEvents = [
      { type: event.type, createdAt: new Date(), payload: event.payload ?? {} },
      ...recentEvents,
    ];

    const unlocked: BadgeRow[] = [];
    const progress: BadgeProgress[] = [];

    for (const badge of badges) {
      // Skip if already unlocked and badge is not progress-tracked
      if (unlockedIds.has(badge.id)) {
        const prog = computeProgress(badge, aggregate, allEvents, true);
        progress.push({
          badge,
          memberId: event.memberId,
          progress: prog.progress,
          currentValue: prog.currentValue,
          targetValue: prog.targetValue,
          unlocked: true,
          unlockedAt: null,
          remainingCount: 0,
        });
        continue;
      }

      // Only evaluate badges whose conditions reference this event type
      const conditions = badge.conditions as Record<string, unknown> | null;
      const conditionsStr = conditions ? JSON.stringify(conditions) : "";
      const relevant =
        !conditions ||
        Object.keys(conditions).length === 0 ||
        conditionsStr.includes(event.type) ||
        conditionsStr.includes("totalSpent") ||
        conditionsStr.includes("totalEarned") ||
        conditionsStr.includes("eventCounts");

      if (!relevant) continue;

      const prog = computeProgress(badge, aggregate, allEvents, false);

      const bp: BadgeProgress = {
        badge,
        memberId: event.memberId,
        progress: prog.progress,
        currentValue: prog.currentValue,
        targetValue: prog.targetValue,
        unlocked: prog.met,
        unlockedAt: null,
        remainingCount: prog.remainingCount,
      };

      progress.push(bp);

      if (prog.met) {
        const mb = await this.repo.upsertMemberBadge(event.memberId, badge.id, {
          progress: 100,
          unlockedAt: new Date(),
        });
        bp.unlocked = true;
        bp.unlockedAt = mb.unlockedAt;
        bp.progress = 100;
        unlocked.push(badge);
      } else {
        await this.repo.upsertMemberBadge(event.memberId, badge.id, {
          progress: prog.progress,
        });
      }
    }

    return { unlocked, progress };
  }

  /**
   * Get progress for a specific badge for a member.
   */
  async progress(memberId: string, badgeId: string): Promise<BadgeProgress | null> {
    const badge = await this.repo.findBadgeById(badgeId);
    if (!badge) throw new BadgeNotFoundError(badgeId);

    const aggregate = await this.repo.findMemberAggregate(memberId);
    if (!aggregate) return null;

    const memberBadge = await this.repo.findMemberBadge(memberId, badgeId);
    const alreadyUnlocked =
      memberBadge?.unlockedAt !== null && memberBadge?.unlockedAt !== undefined;
    const recentEvents = await this.repo.findRecentEvents(
      memberId,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    );

    const prog = computeProgress(badge, aggregate, recentEvents, alreadyUnlocked);

    return {
      badge,
      memberId,
      progress: alreadyUnlocked ? 100 : prog.progress,
      currentValue: prog.currentValue,
      targetValue: prog.targetValue,
      unlocked: alreadyUnlocked || prog.met,
      unlockedAt: memberBadge?.unlockedAt ?? null,
      remainingCount: alreadyUnlocked ? 0 : prog.remainingCount,
    };
  }

  /**
   * Manually award a badge to a member.
   */
  async award(memberId: string, badgeId: string, _source: string) {
    const badge = await this.repo.findBadgeById(badgeId);
    if (!badge) throw new BadgeNotFoundError(badgeId);

    const existing = await this.repo.findMemberBadge(memberId, badgeId);
    if (existing?.unlockedAt) {
      throw new BadgeAlreadyAwardedError(memberId, badgeId);
    }

    const mb = await this.repo.upsertMemberBadge(memberId, badgeId, {
      progress: 100,
      unlockedAt: new Date(),
    });

    return mb;
  }

  /**
   * Get all badges for a member with progress.
   */
  async getMemberBadges(memberId: string): Promise<BadgeProgress[]> {
    const member = await this.repo.findMemberAggregate(memberId);
    if (!member) return [];

    const badges = await this.repo.findAllActiveBadges(member.programId);
    const memberBadges = await this.repo.findMemberBadgesByMember(memberId);
    const unlockedIds = new Set(
      memberBadges
        .filter((mb: { unlockedAt: Date | null }) => mb.unlockedAt)
        .map((mb: { badgeId: string }) => mb.badgeId),
    );
    const recentEvents = await this.repo.findRecentEvents(
      memberId,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    );

    return badges.map((badge) => {
      const alreadyUnlocked = unlockedIds.has(badge.id);
      const existing = memberBadges.find((mb: { badgeId: string }) => mb.badgeId === badge.id);
      const prog = computeProgress(badge, member, recentEvents, alreadyUnlocked);

      return {
        badge,
        memberId,
        progress: alreadyUnlocked ? 100 : Math.max(prog.progress, existing?.progress ?? 0),
        currentValue: prog.currentValue,
        targetValue: prog.targetValue,
        unlocked: alreadyUnlocked || prog.met,
        unlockedAt: existing?.unlockedAt ?? null,
        remainingCount: alreadyUnlocked ? 0 : prog.remainingCount,
      };
    });
  }

  /**
   * Get badge distribution stats for a program.
   */
  async stats(programId: string) {
    return this.repo.countMembersByBadge(programId);
  }
}

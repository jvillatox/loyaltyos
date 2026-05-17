import type { PrismaClient } from "@prisma/client";

import type { Repository } from "./repository.js";
import { createRepository } from "./repository.js";
import type {
  TierCreateInput,
  TierEvaluationResult,
  TierMemberCount,
  TierRow,
  TierUpdateInput,
} from "./types.js";
import { TierNotFoundError, TierRankConflictError } from "./types.js";

export class TiersService {
  private repo: Repository;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN CRUD
  // ═══════════════════════════════════════════════════════════════════

  async create(input: TierCreateInput): Promise<TierRow> {
    const existing = await this.repo.findTierByRank(input.programId, input.rank);
    if (existing) throw new TierRankConflictError(input.rank);
    return this.repo.createTier(input);
  }

  async update(id: string, input: TierUpdateInput): Promise<TierRow> {
    const tier = await this.repo.findTierById(id);
    if (!tier) throw new TierNotFoundError(id);

    if (input.rank !== undefined && input.rank !== tier.rank) {
      const existing = await this.repo.findTierByRank(tier.programId, input.rank);
      if (existing && existing.id !== id) throw new TierRankConflictError(input.rank);
    }

    return this.repo.updateTier(id, input);
  }

  async delete(id: string): Promise<void> {
    const tier = await this.repo.findTierById(id);
    if (!tier) throw new TierNotFoundError(id);
    await this.repo.deleteTier(id);
  }

  async getById(id: string): Promise<TierRow> {
    const tier = await this.repo.findTierById(id);
    if (!tier) throw new TierNotFoundError(id);
    return tier;
  }

  async list(programId: string): Promise<TierRow[]> {
    return this.repo.findTiersByProgram(programId);
  }

  async reorder(programId: string, tierIds: string[]): Promise<void> {
    const tiers = await this.repo.findTiersByProgram(programId);
    const idToTier = new Map(tiers.map((t) => [t.id, t]));

    for (let i = 0; i < tierIds.length; i++) {
      const tierId = tierIds[i]!;
      const tier = idToTier.get(tierId);
      if (!tier) throw new TierNotFoundError(tierId);
      const newRank = i + 1;
      if (tier.rank !== newRank) {
        await this.repo.updateTier(tierId, { rank: newRank });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVALUATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Evaluate and assign the correct tier for a member.
   * Triggered after points earn events.
   * Returns the evaluation result with upgrade/downgrade info.
   */
  async evaluateMember(memberId: string, programId: string): Promise<TierEvaluationResult> {
    const aggregate = await this.repo.findMemberAggregate(memberId);
    if (!aggregate) {
      throw new Error(`Member not found: ${memberId}`);
    }

    const tiers = await this.repo.findTiersByProgram(programId);
    if (tiers.length === 0) {
      return {
        currentTier: null,
        previousTier: null,
        changed: false,
        direction: null,
        pointsProgress: 0,
        pointsToNext: null,
        nextTier: null,
      };
    }

    // Determine the correct tier based on total earned points
    // Tiers are ordered by rank ascending — higher rank = higher tier
    let correctTier: TierRow | null = null;
    let nextTier: TierRow | null = null;

    for (const tier of tiers) {
      if (aggregate.totalEarned >= tier.minPoints) {
        correctTier = tier;
      } else if (correctTier && !nextTier) {
        nextTier = tier;
      }
    }

    // Current tier from DB
    const currentMemberTier = await this.repo.findCurrentTier(memberId);

    const previousTier = currentMemberTier?.tier ?? null;
    const previousTierId = currentMemberTier?.tierId ?? null;

    // No change
    if (correctTier && previousTierId === correctTier.id) {
      // Compute progress to next tier
      const pointsProgress = nextTier
        ? Math.min(
            100,
            Math.round(
              ((aggregate.totalEarned - correctTier.minPoints) /
                (nextTier.minPoints - correctTier.minPoints)) *
                100,
            ),
          )
        : 100;
      return {
        currentTier: correctTier,
        previousTier: correctTier,
        changed: false,
        direction: null,
        pointsProgress,
        pointsToNext: nextTier ? nextTier.minPoints - aggregate.totalEarned : null,
        nextTier,
      };
    }

    // No tier assigned yet — assign the first eligible tier
    if (!previousTierId && correctTier) {
      await this.repo.createMemberTier(memberId, correctTier.id);
      return {
        currentTier: correctTier,
        previousTier: null,
        changed: true,
        direction: "upgrade",
        pointsProgress: nextTier
          ? Math.min(
              100,
              Math.round(
                ((aggregate.totalEarned - correctTier.minPoints) /
                  (nextTier.minPoints - correctTier.minPoints)) *
                  100,
              ),
            )
          : 100,
        pointsToNext: nextTier ? nextTier.minPoints - aggregate.totalEarned : null,
        nextTier,
      };
    }

    // Tier upgrade
    if (correctTier && previousTierId !== correctTier.id) {
      // Downgrade previous tier
      await this.repo.downgradeMemberTier(memberId);
      // Assign new tier
      await this.repo.createMemberTier(memberId, correctTier.id);

      const isUpgrade = correctTier.rank > (previousTier?.rank ?? 0);

      const pointsProgress = nextTier
        ? Math.min(
            100,
            Math.round(
              ((aggregate.totalEarned - correctTier.minPoints) /
                (nextTier.minPoints - correctTier.minPoints)) *
                100,
            ),
          )
        : 100;

      return {
        currentTier: correctTier,
        previousTier,
        changed: true,
        direction: isUpgrade ? "upgrade" : "downgrade",
        pointsProgress,
        pointsToNext: nextTier ? nextTier.minPoints - aggregate.totalEarned : null,
        nextTier,
      };
    }

    // No eligible tier
    return {
      currentTier: null,
      previousTier,
      changed: previousTier !== null,
      direction: previousTier ? "downgrade" : null,
      pointsProgress: 0,
      pointsToNext: tiers[0] ? tiers[0].minPoints - aggregate.totalEarned : null,
      nextTier: tiers[0] ?? null,
    };
  }

  /**
   * Nightly job: re-evaluate all members for downgrades due to inactivity.
   * Members with no events in 90 days may lose a tier rank.
   */
  async recomputeAll(programId: string): Promise<{ downgraded: number; total: number }> {
    const members = await this.repo.findMembersByProgram(programId);
    // Re-evaluate each member's tier
    let downgraded = 0;

    for (const member of members) {
      const result = await this.evaluateMember(member.id, programId);
      if (result.direction === "downgrade") {
        downgraded++;
      }
    }

    return { downgraded, total: members.length };
  }

  /**
   * Get benefits for a tier.
   */
  async benefits(tierId: string): Promise<Record<string, unknown>> {
    const tier = await this.repo.findTierById(tierId);
    if (!tier) throw new TierNotFoundError(tierId);
    return tier.benefits ? (tier.benefits as Record<string, unknown>) : {};
  }

  /**
   * Get tier for a specific member with progress info.
   */
  async getMemberTier(memberId: string, programId: string): Promise<TierEvaluationResult> {
    return this.evaluateMember(memberId, programId);
  }

  /**
   * Get tier distribution for a program (pyramid stats).
   */
  async stats(programId: string): Promise<TierMemberCount[]> {
    return this.repo.countMembersByTier(programId);
  }

  /**
   * Get the current tier for a member (lightweight, no re-evaluation).
   */
  async getCurrentTier(memberId: string): Promise<TierRow | null> {
    const mt = await this.repo.findCurrentTier(memberId);
    return mt?.tier ?? null;
  }
}

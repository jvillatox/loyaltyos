import { PointsService } from "@loyaltyos/core";
import type { Prisma, PrismaClient } from "@prisma/client";

import { createRepository } from "./repository.js";
import type {
  DetailResult,
  EligibilityResult,
  RedeemResult,
  RewardCreateInput,
  RewardListFilters,
  RewardUpdateInput,
  RewardWithRedemptions,
} from "./types.js";
import {
  RewardInsufficientPointsError,
  RewardNotActiveError,
  RewardNotFoundError,
  RewardOutOfStockError,
  RewardTierInsufficientError,
} from "./types.js";

export class RewardsService {
  private repo: ReturnType<typeof createRepository>;
  private points: PointsService;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
    this.points = new PointsService(prisma);
  }

  // ── Admin CRUD ────────────────────────────────────────────────────────────

  async create(input: RewardCreateInput) {
    return this.repo.create(input);
  }

  async update(id: string, input: RewardUpdateInput) {
    const reward = await this.repo.findById(id);
    if (!reward) throw new RewardNotFoundError(id);
    return this.repo.update(id, input);
  }

  async softDelete(id: string): Promise<void> {
    const reward = await this.repo.findById(id);
    if (!reward) throw new RewardNotFoundError(id);
    await this.repo.softDelete(id);
  }

  async archive(id: string): Promise<void> {
    await this.softDelete(id);
  }

  async publish(id: string) {
    const reward = await this.repo.findById(id);
    if (!reward) throw new RewardNotFoundError(id);
    return this.repo.publish(id);
  }

  async restock(id: string, qty: number) {
    const reward = await this.repo.findById(id);
    if (!reward) throw new RewardNotFoundError(id);
    return this.repo.incrementStock(id, qty);
  }

  async getById(id: string): Promise<RewardWithRedemptions> {
    const reward = await this.repo.findById(id);
    if (!reward) throw new RewardNotFoundError(id);
    return reward;
  }

  // ── Public catalog ────────────────────────────────────────────────────────

  async list(programId: string, filters: RewardListFilters) {
    return this.repo.findMany(programId, filters);
  }

  async detail(id: string, memberId?: string): Promise<DetailResult> {
    const reward = await this.repo.findById(id);
    if (!reward) throw new RewardNotFoundError(id);

    if (memberId) {
      try {
        const eligibility = await this.checkEligibility(id, memberId);
        return { ...reward, eligible: eligibility.eligible, reason: eligibility.reason };
      } catch (err) {
        return { ...reward, eligible: false, reason: (err as Error).message };
      }
    }

    return reward;
  }

  // ── Eligibility ───────────────────────────────────────────────────────────

  async checkEligibility(rewardId: string, memberId: string): Promise<EligibilityResult> {
    const reward = await this.repo.findById(rewardId);
    if (!reward) throw new RewardNotFoundError(rewardId);

    if (!reward.isActive) {
      throw new RewardNotActiveError(rewardId);
    }

    if (reward.stock != null && reward.stock <= 0) {
      throw new RewardOutOfStockError(rewardId);
    }

    if (reward.tierRequired) {
      const memberTier = await this.repo.findMemberActiveTier(memberId);
      const requiredTier = await this.repo.findTierByName(reward.programId, reward.tierRequired);

      if (!requiredTier) {
        throw new Error(`Tier "${reward.tierRequired}" not found in program`);
      }

      if (!memberTier || memberTier.tier.rank < requiredTier.rank) {
        const currentName = memberTier?.tier.name ?? "none";
        throw new RewardTierInsufficientError(reward.tierRequired, currentName);
      }
    }

    const balance = await this.repo.findMemberBalance(memberId, reward.programId);
    const currentPoints = balance?.balance ?? 0;
    if (currentPoints < reward.pointsCost) {
      throw new RewardInsufficientPointsError(reward.pointsCost, currentPoints);
    }

    return { eligible: true, reward };
  }

  // ── Redeem ────────────────────────────────────────────────────────────────

  async redeem(rewardId: string, memberId: string, idempotencyKey: string): Promise<RedeemResult> {
    const reward = await this.repo.findById(rewardId);
    if (!reward) throw new RewardNotFoundError(rewardId);

    // Idempotency: if we already recorded a redemption for this key, skip the
    // heavy lifting and call PointsService directly — its own idempotency guard
    // will return the existing transaction if there is one, or complete the
    // deduction if the previous attempt crashed before reaching PointsService.
    const existingRedemption = await this.repo.findRedemptionByIdempotencyKey(
      rewardId,
      idempotencyKey,
    );

    if (existingRedemption) {
      const pointsResult = await this.points.redeem({
        memberId,
        programId: reward.programId,
        amount: existingRedemption.pointsSpent,
        source: `reward:${rewardId}`,
        idempotencyKey,
        metadata: { rewardId },
      });

      return {
        redemption: {
          id: existingRedemption.id,
          rewardId: existingRedemption.rewardId,
          memberId: existingRedemption.memberId,
          pointsSpent: existingRedemption.pointsSpent,
        },
        transaction: {
          transactionId: pointsResult.transactionId,
          amount: pointsResult.amount,
          balanceAfter: pointsResult.balanceAfter,
          idempotent: pointsResult.idempotent,
        },
      };
    }

    // Eligibility checks (throw specific errors before touching stock/points)
    if (!reward.isActive) {
      throw new RewardNotActiveError(rewardId);
    }

    if (reward.stock != null && reward.stock <= 0) {
      throw new RewardOutOfStockError(rewardId);
    }

    if (reward.tierRequired) {
      const memberTier = await this.repo.findMemberActiveTier(memberId);
      const requiredTier = await this.repo.findTierByName(reward.programId, reward.tierRequired);

      if (!requiredTier) {
        throw new Error(`Tier "${reward.tierRequired}" not found in program`);
      }

      if (!memberTier || memberTier.tier.rank < requiredTier.rank) {
        throw new RewardTierInsufficientError(reward.tierRequired, memberTier?.tier.name ?? "none");
      }
    }

    const balance = await this.repo.findMemberBalance(memberId, reward.programId);
    const currentPoints = balance?.balance ?? 0;
    if (currentPoints < reward.pointsCost) {
      throw new RewardInsufficientPointsError(reward.pointsCost, currentPoints);
    }

    // Atomic stock decrement (no-op when stock is null → unlimited)
    const stockTracked = reward.stock != null;
    if (stockTracked) {
      const decremented = await this.repo.decrementStock(rewardId);
      if (!decremented) {
        throw new RewardOutOfStockError(rewardId);
      }
    }

    // Record the redemption
    const redemption = await this.repo.recordRedemption(rewardId, memberId, reward.pointsCost, {
      idempotencyKey,
    } as Prisma.InputJsonValue);

    // Deduct points via core engine
    try {
      const pointsResult = await this.points.redeem({
        memberId,
        programId: reward.programId,
        amount: reward.pointsCost,
        source: `reward:${rewardId}`,
        idempotencyKey,
        metadata: { rewardId, redemptionId: redemption.id },
      });

      return {
        redemption: {
          id: redemption.id,
          rewardId: redemption.rewardId,
          memberId: redemption.memberId,
          pointsSpent: redemption.pointsSpent,
        },
        transaction: {
          transactionId: pointsResult.transactionId,
          amount: pointsResult.amount,
          balanceAfter: pointsResult.balanceAfter,
          idempotent: pointsResult.idempotent,
        },
      };
    } catch (err) {
      // Rollback — best effort (don't mask the original error)
      if (stockTracked) {
        await this.repo.incrementStock(rewardId, 1);
      }
      await this.repo.deleteRedemption(redemption.id);
      throw err;
    }
  }
}

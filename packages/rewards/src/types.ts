import type { Reward } from "@prisma/client";

export type RewardRow = Reward;

export const ALLOWED_CATEGORIES = [
  "DISCOUNT_FUTURE",
  "PHYSICAL_PRODUCT",
  "GIFT_CARD",
  "EXPERIENCE",
  "CHARITY_DONATION",
  "COALITION_TRANSFER",
] as const;

export type RewardCategory = (typeof ALLOWED_CATEGORIES)[number];

// ── Input / output interfaces ──────────────────────────────────────────────

export interface RewardCreateInput {
  programId: string;
  name: string;
  description?: string;
  pointsCost: number;
  stock?: number | null;
  imageUrl?: string;
  category?: RewardCategory;
  tierRequired?: string;
}

export type RewardUpdateInput = Partial<Omit<RewardCreateInput, "programId">>;

export interface RewardListFilters {
  category?: string;
  isActive?: boolean;
  minPoints?: number;
  maxPoints?: number;
  tierRequired?: string;
  page?: number;
  pageSize?: number;
}

export interface RewardWithRedemptions extends RewardRow {
  redemptions: { id: string; memberId: string }[];
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  reward: RewardWithRedemptions;
}

export interface DetailResult extends RewardWithRedemptions {
  eligible?: boolean;
  reason?: string;
}

export interface RedeemResult {
  redemption: {
    id: string;
    rewardId: string;
    memberId: string;
    pointsSpent: number;
  };
  transaction: {
    transactionId: string;
    amount: number;
    balanceAfter: number;
    idempotent: boolean;
  };
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class RewardNotFoundError extends Error {
  constructor(id: string) {
    super(`Reward not found: ${id}`);
    this.name = "RewardNotFoundError";
  }
}

export class RewardNotActiveError extends Error {
  constructor(id: string) {
    super(`Reward "${id}" is not active`);
    this.name = "RewardNotActiveError";
  }
}

export class RewardOutOfStockError extends Error {
  constructor(id: string) {
    super(`Reward "${id}" is out of stock`);
    this.name = "RewardOutOfStockError";
  }
}

export class RewardTierInsufficientError extends Error {
  constructor(required: string, current: string) {
    super(`Tier "${required}" required, but member has "${current}"`);
    this.name = "RewardTierInsufficientError";
  }
}

export class RewardInsufficientPointsError extends Error {
  constructor(required: number, current: number) {
    super(`Insufficient points: need ${String(required)}, have ${String(current)}`);
    this.name = "RewardInsufficientPointsError";
  }
}

import type { Badge, Tier } from "@prisma/client";

export type BadgeRow = Badge;
export type TierRow = Tier;

// ── Badge types ──────────────────────────────────────────────────────────

export interface BadgeCreateInput {
  programId: string;
  name: string;
  description?: string;
  type: "ACHIEVEMENT" | "STATUS" | "TEMPORAL" | "COLLECTIBLE" | "SOCIAL";
  imageUrl?: string;
  tierId?: string;
  conditions?: Record<string, unknown>;
  seriesId?: string;
  seriesPosition?: number;
}

export interface BadgeUpdateInput {
  name?: string;
  description?: string;
  type?: "ACHIEVEMENT" | "STATUS" | "TEMPORAL" | "COLLECTIBLE" | "SOCIAL";
  imageUrl?: string;
  tierId?: string;
  conditions?: Record<string, unknown>;
  seriesId?: string;
  seriesPosition?: number;
  isActive?: boolean;
}

export interface BadgeListFilters {
  type?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface BadgeProgress {
  badge: BadgeRow;
  memberId: string;
  progress: number; // 0-100
  currentValue: number;
  targetValue: number;
  unlocked: boolean;
  unlockedAt: Date | null;
  remainingCount: number;
}

export interface BadgeEvaluation {
  unlocked: BadgeRow[];
  progress: BadgeProgress[];
}

// ── Tier types ───────────────────────────────────────────────────────────

export interface TierCreateInput {
  programId: string;
  name: string;
  rank: number;
  minPoints: number;
  color?: string;
  iconUrl?: string;
  benefits?: Record<string, unknown>;
}

export interface TierUpdateInput {
  name?: string;
  rank?: number;
  minPoints?: number;
  color?: string;
  iconUrl?: string;
  benefits?: Record<string, unknown>;
}

export interface TierEvaluationResult {
  currentTier: TierRow | null;
  previousTier: TierRow | null;
  changed: boolean;
  direction: "upgrade" | "downgrade" | null;
  pointsProgress: number; // 0-100
  pointsToNext: number | null;
  nextTier: TierRow | null;
}

// ── Member aggregate for evaluation ─────────────────────────────────────

export interface MemberAggregate {
  id: string;
  programId: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  joinedAt: Date;
  deletedAt: Date | null;
  totalEarned: number;
  totalRedeemed: number;
  currentBalance: number;
  currentTier: string | null;
  currentTierId: string | null;
  currentTierRank: number | null;
  eventCounts: Record<string, number>; // eventType -> count
  totalSpent: number;
  lastEventAt: Date | null;
}

// ── Tier member count for stats ──────────────────────────────────────────

export interface TierMemberCount {
  tierId: string;
  tierName: string;
  rank: number;
  memberCount: number;
}

export interface BadgeMemberCount {
  badgeId: string;
  badgeName: string;
  type: string;
  unlockedCount: number;
  totalProgress: number; // average progress across all members
}

// ── Errors ───────────────────────────────────────────────────────────────

export class BadgeNotFoundError extends Error {
  constructor(id: string) {
    super(`Badge not found: ${id}`);
    this.name = "BadgeNotFoundError";
  }
}

export class TierNotFoundError extends Error {
  constructor(id: string) {
    super(`Tier not found: ${id}`);
    this.name = "TierNotFoundError";
  }
}

export class TierRankConflictError extends Error {
  constructor(rank: number) {
    super(`Tier with rank ${String(rank)} already exists`);
    this.name = "TierRankConflictError";
  }
}

export class BadgeAlreadyAwardedError extends Error {
  constructor(memberId: string, badgeId: string) {
    super(`Badge ${badgeId} already awarded to member ${memberId}`);
    this.name = "BadgeAlreadyAwardedError";
  }
}

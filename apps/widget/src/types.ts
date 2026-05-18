// ── Widget configuration ──────────────────────────────────────────────────

export interface WidgetConfig {
  apiKey: string;
  apiUrl: string;
  programId: string;
  memberId: string;
}

// ── API response types (mirrors backend responses) ────────────────────────

export interface Balance {
  confirmed: number;
  pending: number;
  total: number;
}

export interface PointTransaction {
  id: string;
  type: "EARN" | "REDEEM" | "ADJUST" | "REVERSE" | "EXPIRE";
  amount: number;
  balanceAfter: number;
  source: string;
  description?: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BadgeProgress {
  progress: number;
  currentValue: number;
  targetValue: number;
  unlocked: boolean;
  unlockedAt: string | null;
  remainingCount: number;
  badge: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    imageUrl: string | null;
  };
}

export interface TierStatus {
  currentTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
    color: string | null;
    iconUrl: string | null;
    benefits: unknown;
  } | null;
  previousTier: {
    id: string;
    name: string;
    rank: number;
  } | null;
  changed: boolean;
  direction: "upgrade" | "downgrade" | null;
  pointsProgress: number;
  pointsToNext: number | null;
  nextTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
  } | null;
}

export interface RewardRow {
  id: string;
  programId: string;
  name: string;
  description: string | null;
  pointsCost: number;
  stock: number | null;
  imageUrl: string | null;
  category: string | null;
  tierRequired: string | null;
  isActive: boolean;
  redemptions: { id: string; memberId: string }[];
}

export interface RewardDetail extends RewardRow {
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

export interface MemberProfile {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  metadata: unknown;
  tags: string[];
  joinedAt: string;
}

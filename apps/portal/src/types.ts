export interface MemberProfile {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  joinedAt: string;
}

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
  description: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Reward {
  id: string;
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

export interface RewardDetail extends Reward {
  eligible?: boolean;
  reason?: string;
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
  } | null;
  nextTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
  } | null;
  pointsProgress: number;
  pointsToNext: number | null;
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
  };
}

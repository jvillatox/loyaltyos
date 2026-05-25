export interface Member {
  id: string;
  email: string;
  name: string;
  tier: string | null;
  pointBalance: number;
  pendingBalance: number;
  joinedAt: string;
  lastActivityAt: string | null;
  totalSpend: number;
}

export interface PointTransaction {
  id: string;
  memberId: string;
  amount: number;
  type: "earn" | "burn" | "expire" | "adjust";
  description: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  type: string;
  status: "active" | "draft" | "paused" | "ended";
  startDate: string;
  endDate: string | null;
  segmentId: string | null;
  rules: Record<string, unknown>;
  stackable: boolean;
  budgetCap: number | null;
  membersReached?: number;
  pointsIssued?: number;
  redemptions?: number;
  conversionRate?: number;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  updatedAt: string;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  earnedAt: string;
}

export interface BadgeProgress {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  progress: number; // 0-100
}

export interface Coupon {
  id: string;
  name: string;
  type: string;
  value: number;
  code?: string;
  quantity?: number;
  expiresAt?: string | null;
  minPurchaseAmount?: number | null;
  maxUsesPerMember?: number;
  segmentId?: string | null;
}

export interface Reward {
  id: string;
  name: string;
  description: string;
  type: string;
  pointCost: number;
  stock: number | null;
  imageUrl: string | null;
}

export interface AnalyticsDashboard {
  activeMembers: number;
  newMembers: number;
  pointsIssued: number;
  pointsRedeemed: number;
  redemptionRate: number;
  totalLiability: number;
  topCampaigns: {
    id: string;
    name: string;
    pointsIssued: number;
    membersReached: number;
  }[];
  period: string;
}

export interface CampaignAnalytics {
  campaignId: string;
  name: string;
  membersEligible: number;
  membersReached: number;
  pointsIssued: number;
  budgetUsed: number;
  budgetRemaining: number | null;
  conversionRate: number;
  dailyTrend: {
    date: string;
    pointsIssued: number;
    membersReached: number;
  }[];
}

export interface LoyaltyOSError {
  statusCode: number;
  message: string;
  code?: string;
}

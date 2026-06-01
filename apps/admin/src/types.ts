export interface Member {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  metadata: unknown;
  tags: string[];
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  pointAccount?: { balance: number } | null;
}

export interface DashboardStats {
  activeMembers: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  redemptionRatio: number;
  recentTransactions: number;
}

export interface PointTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  source: string;
  description: string | null;
  createdAt: string;
}

export interface Balance {
  confirmed: number;
  pending: number;
  total: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type CampaignType =
  | "BONUS_POINTS"
  | "SPEND_AND_GET"
  | "FREQUENCY"
  | "MILESTONE"
  | "REFERRAL"
  | "BIRTHDAY"
  | "ANNIVERSARY"
  | "FLASH_SALE"
  | "TIER_UPGRADE_BONUS";

export interface CampaignVariant {
  id: string;
  name: string;
  trafficPct: number;
  config: unknown;
}

export interface Campaign {
  id: string;
  programId: string;
  name: string;
  description: string | null;
  type: CampaignType;
  conditions: unknown;
  multiplier: number;
  maxBudget: number | null;
  maxUsesPerMember: number | null;
  isStackable: boolean;
  isActive: boolean;
  abTesting: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants?: CampaignVariant[];
  applications?: unknown[];
}

export interface CampaignEstimate {
  estimatedMembers: number;
  estimatedPoints: number;
  estimatedCost: number;
}

export type CouponMode = "SHARED" | "INDIVIDUAL" | "LIMITED";

export type CouponDiscountType =
  | "PERCENTAGE"
  | "FIXED"
  | "FREE_PRODUCT"
  | "FREE_SHIPPING"
  | "EXTRA_POINTS"
  | "EXPERIENCE";

export interface Coupon {
  id: string;
  programId: string;
  code: string;
  mode: CouponMode;
  discountType: CouponDiscountType;
  discountValue: number | null;
  minPurchase: number | null;
  maxUses: number | null;
  maxUsesPerMember: number | null;
  usedCount: number;
  isStackable: boolean;
  isActive: boolean;
  channels: string[];
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponStats {
  totalRedemptions: number;
  uniqueMembers: number;
  totalDiscount: number;
  redemptionRate: number;
}

export type SegmentType = "STATIC" | "DYNAMIC";

export interface RuleCondition {
  field: string;
  eq?: unknown;
  neq?: unknown;
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
  in?: unknown[];
  between?: [number, number];
  contains?: string;
}

export interface RuleGroup {
  all?: (RuleCondition | RuleGroup)[];
  any?: (RuleCondition | RuleGroup)[];
}

export interface Segment {
  id: string;
  programId: string;
  name: string;
  description: string | null;
  type: SegmentType;
  rules: RuleGroup | null;
  memberIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentMemberCount {
  count: number;
}

export interface GiftCardBatch {
  id: string;
  programId: string;
  name: string;
  quantity: number;
  initialAmount: number;
  currency: string;
  prefix?: string;
  expirationDate: string;
  termsTemplateId: string;
  status: string;
  generatedCount: number;
  createdById: string;
  createdAt: string;
}

export interface GiftCard {
  id: string;
  code: string;
  batchId: string;
  initialAmount: number;
  balance: number;
  currency: string;
  expirationDate: string;
  status: string;
  activatedAt?: string;
  lastRedemptionAt?: string;
}

export interface GiftCardTransaction {
  id: string;
  giftCardId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  memberId?: string;
  orderRef?: string;
  idempotencyKey?: string;
  createdById?: string;
  createdAt: string;
}

export interface TermsTemplate {
  id: string;
  programId: string;
  name: string;
  locale: string;
  body: string;
  version: number;
  isActive: boolean;
  createdAt: string;
}

export interface GiftCardMetrics {
  outstandingBalances: { programId: string; currency: string; total: number }[];
  activeCards: number;
  redeemedLast30d: number;
}

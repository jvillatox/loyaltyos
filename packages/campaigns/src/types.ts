import type { CampaignType } from "@prisma/client";

export type { CampaignType };

export interface CampaignVariantInput {
  name: string;
  trafficPct: number;
  config?: Record<string, unknown>;
}

export interface CampaignCreateInput {
  programId: string;
  name: string;
  description?: string;
  type: CampaignType;
  conditions?: Record<string, unknown>;
  multiplier?: number;
  maxBudget?: number;
  maxUsesPerMember?: number;
  isStackable?: boolean;
  abTesting?: boolean;
  startsAt?: Date;
  endsAt?: Date;
  variants?: CampaignVariantInput[];
}

export interface CampaignUpdateInput {
  name?: string;
  description?: string;
  conditions?: Record<string, unknown>;
  multiplier?: number;
  maxBudget?: number;
  maxUsesPerMember?: number;
  isStackable?: boolean;
  abTesting?: boolean;
  startsAt?: Date;
  endsAt?: Date;
}

export interface EventContext {
  type: string;
  memberId: string;
  programId: string;
  amount?: number;
  payload?: Record<string, unknown>;
}

export interface CampaignWithVariants {
  id: string;
  programId: string;
  name: string;
  description: string | null;
  type: CampaignType;
  conditions: Record<string, unknown> | null;
  multiplier: number;
  maxBudget: number | null;
  maxUsesPerMember: number | null;
  isStackable: boolean;
  isActive: boolean;
  abTesting: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  variants: {
    id: string;
    campaignId: string;
    name: string;
    trafficPct: number;
    config: Record<string, unknown> | null;
    createdAt: Date;
  }[];
}

export interface CampaignEvaluation {
  applicable: CampaignWithVariants[];
  reasons: Map<string, string>;
  variantAssignments: Map<string, string | null>;
}

export interface ApplyResult {
  campaignId: string;
  memberId: string;
  pointsAwarded: number;
  variantId: string | null;
  applicationId: string;
  idempotent: boolean;
}

export interface EstimateInput {
  programId: string;
  type?: CampaignType;
  conditions?: Record<string, unknown>;
  multiplier?: number;
  maxBudget?: number;
}

export interface EstimateResult {
  estimatedMembers: number;
  estimatedPoints: number;
  estimatedCost: number;
}

export class CampaignNotFoundError extends Error {
  constructor(id: string) {
    super(`Campaign not found: ${id}`);
    this.name = "CampaignNotFoundError";
  }
}

export class CampaignBudgetExhaustedError extends Error {
  constructor(campaignId: string) {
    super(`Campaign budget exhausted: ${campaignId}`);
    this.name = "CampaignBudgetExhaustedError";
  }
}

export class CampaignUserLimitReachedError extends Error {
  constructor(campaignId: string, memberId: string) {
    super(`Member ${memberId} has reached the limit for campaign ${campaignId}`);
    this.name = "CampaignUserLimitReachedError";
  }
}

export class CampaignNotActiveError extends Error {
  constructor(campaignId: string) {
    super(`Campaign is not active: ${campaignId}`);
    this.name = "CampaignNotActiveError";
  }
}

export class CampaignOutOfValidityError extends Error {
  constructor(campaignId: string) {
    super(`Campaign is outside its validity period: ${campaignId}`);
    this.name = "CampaignOutOfValidityError";
  }
}

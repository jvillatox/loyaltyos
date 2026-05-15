import type { PointsService } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";

import { assignVariant } from "./ab-testing.js";
import { createRepository } from "./repository.js";
import { evaluateRules } from "./rules.js";
import { campaignCreateSchema, campaignUpdateSchema } from "./schemas.js";
import type {
  ApplyResult,
  CampaignCreateInput,
  CampaignEvaluation,
  CampaignUpdateInput,
  CampaignWithVariants,
  EstimateInput,
  EstimateResult,
  EventContext,
} from "./types.js";
import {
  CampaignBudgetExhaustedError,
  CampaignNotActiveError,
  CampaignNotFoundError,
  CampaignOutOfValidityError,
  CampaignUserLimitReachedError,
} from "./types.js";

export class CampaignsService {
  private repo: ReturnType<typeof createRepository>;
  private points: PointsService;

  constructor(prisma: PrismaClient, pointsService: PointsService) {
    this.repo = createRepository(prisma);
    this.points = pointsService;
  }

  async create(input: CampaignCreateInput): Promise<CampaignWithVariants> {
    const parsed = campaignCreateSchema.parse(input);
    return this.repo.createCampaign(parsed as CampaignCreateInput);
  }

  async update(id: string, input: CampaignUpdateInput): Promise<CampaignWithVariants> {
    const parsed = campaignUpdateSchema.parse(input);
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError(id);
    return this.repo.updateCampaign(id, parsed as CampaignUpdateInput);
  }

  async activate(id: string): Promise<void> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError(id);
    await this.repo.updateStatus(id, true);
  }

  async pause(id: string): Promise<void> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError(id);
    await this.repo.updateStatus(id, false);
  }

  async archive(id: string): Promise<void> {
    const campaign = await this.repo.findById(id);
    if (!campaign) throw new CampaignNotFoundError(id);
    await this.repo.softDelete(id);
  }

  async evaluateForEvent(event: EventContext): Promise<CampaignEvaluation> {
    const campaigns = await this.repo.findActiveForEvent(event.programId, event.type);

    const applicable: CampaignWithVariants[] = [];
    const reasons = new Map<string, string>();
    const variantAssignments = new Map<string, string | null>();

    for (const campaign of campaigns) {
      const now = new Date();

      if (campaign.startsAt && campaign.startsAt > now) {
        reasons.set(campaign.id, "Campaign has not started yet");
        continue;
      }
      if (campaign.endsAt && campaign.endsAt < now) {
        reasons.set(campaign.id, "Campaign has ended");
        continue;
      }

      if (campaign.conditions && Object.keys(campaign.conditions).length > 0) {
        const context = {
          type: event.type,
          memberId: event.memberId,
          programId: event.programId,
          amount: event.amount ?? 0,
          ...(event.payload ?? {}),
        };
        if (!evaluateRules(campaign.conditions as Record<string, unknown> | null, context)) {
          reasons.set(campaign.id, "Conditions not met");
          continue;
        }
      }

      if (campaign.maxBudget) {
        const totalAwarded = await this.repo.getTotalAwarded(campaign.id);
        if (totalAwarded >= campaign.maxBudget) {
          reasons.set(campaign.id, "Budget exhausted");
          continue;
        }
      }

      if (campaign.maxUsesPerMember) {
        const count = await this.repo.getApplicationCount(campaign.id, event.memberId);
        if (count >= campaign.maxUsesPerMember) {
          reasons.set(campaign.id, "Per-member limit reached");
          continue;
        }
      }

      let variantId: string | null = null;
      if (campaign.abTesting && campaign.variants.length > 0) {
        variantId = assignVariant(event.memberId, campaign.id, campaign.variants);
      }

      applicable.push(campaign);
      variantAssignments.set(campaign.id, variantId);
    }

    return { applicable, reasons, variantAssignments };
  }

  async applyCampaign(
    campaignId: string,
    eventContext: EventContext,
    idempotencyKey?: string,
  ): Promise<ApplyResult> {
    const campaign = await this.repo.findById(campaignId);
    if (!campaign) throw new CampaignNotFoundError(campaignId);

    if (!campaign.isActive) throw new CampaignNotActiveError(campaignId);

    const now = new Date();
    if (campaign.startsAt && campaign.startsAt > now) {
      throw new CampaignOutOfValidityError(campaignId);
    }
    if (campaign.endsAt && campaign.endsAt < now) {
      throw new CampaignOutOfValidityError(campaignId);
    }

    if (campaign.conditions && Object.keys(campaign.conditions).length > 0) {
      const context = {
        type: eventContext.type,
        memberId: eventContext.memberId,
        programId: eventContext.programId,
        amount: eventContext.amount ?? 0,
        ...(eventContext.payload ?? {}),
      };
      if (!evaluateRules(campaign.conditions as Record<string, unknown> | null, context)) {
        throw new Error("Campaign conditions not met");
      }
    }

    if (campaign.maxBudget) {
      const totalAwarded = await this.repo.getTotalAwarded(campaign.id);
      if (totalAwarded >= campaign.maxBudget) {
        throw new CampaignBudgetExhaustedError(campaignId);
      }
    }

    if (campaign.maxUsesPerMember) {
      const count = await this.repo.getApplicationCount(campaign.id, eventContext.memberId);
      if (count >= campaign.maxUsesPerMember) {
        throw new CampaignUserLimitReachedError(campaignId, eventContext.memberId);
      }
    }

    let pointsAwarded = 0;
    if (campaign.type === "BONUS_POINTS") {
      const baseAmount = eventContext.amount ?? 0;
      const effectiveAmount = Math.floor(baseAmount * (campaign.multiplier - 1));
      if (effectiveAmount > 0) {
        const earnResult = await this.points.earn({
          memberId: eventContext.memberId,
          programId: eventContext.programId,
          amount: effectiveAmount,
          source: `campaign:${campaign.id}`,
          idempotencyKey: idempotencyKey ?? `${eventContext.memberId}:${campaign.id}:earn`,
        });
        if (!earnResult.idempotent) {
          pointsAwarded = effectiveAmount;
        }
      }
    }

    let variantId: string | null = null;
    if (campaign.abTesting && campaign.variants.length > 0) {
      variantId = assignVariant(eventContext.memberId, campaign.id, campaign.variants);
    }

    const application = await this.repo.recordApplication({
      campaignId,
      variantId,
      memberId: eventContext.memberId,
      eventId: undefined,
      pointsAwarded,
      metadata: eventContext.payload,
    });

    return {
      campaignId,
      memberId: eventContext.memberId,
      pointsAwarded,
      variantId,
      applicationId: application.id,
      idempotent: pointsAwarded === 0,
    };
  }

  async estimateImpact(input: EstimateInput): Promise<EstimateResult> {
    const estimatedMembers = await this.repo.countEligibleMembers(input.programId);
    const multiplier = input.multiplier ?? 1;
    const estimatedPoints = estimatedMembers * 100 * multiplier;
    const estimatedCost = input.maxBudget
      ? Math.min(estimatedPoints, input.maxBudget)
      : estimatedPoints;
    return { estimatedMembers, estimatedPoints, estimatedCost };
  }
}

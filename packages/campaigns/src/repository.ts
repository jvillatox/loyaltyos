import type { Prisma, PrismaClient } from "@prisma/client";

import type { CampaignCreateInput, CampaignUpdateInput, CampaignWithVariants } from "./types.js";

function asJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

export function createRepository(prisma: PrismaClient) {
  return {
    async createCampaign(input: CampaignCreateInput): Promise<CampaignWithVariants> {
      const { variants, ...data } = input;
      return (await prisma.campaign.create({
        data: {
          ...data,
          conditions: asJson(data.conditions),
          variants: variants
            ? {
                create: variants.map((v) => ({
                  name: v.name,
                  trafficPct: v.trafficPct,
                  config: asJson(v.config),
                })),
              }
            : undefined,
        },
        include: { variants: true },
      })) as unknown as CampaignWithVariants;
    },

    async updateCampaign(id: string, input: CampaignUpdateInput): Promise<CampaignWithVariants> {
      return (await prisma.campaign.update({
        where: { id },
        data: {
          ...input,
          conditions: input.conditions ? asJson(input.conditions) : undefined,
        },
        include: { variants: true },
      })) as unknown as CampaignWithVariants;
    },

    async updateStatus(id: string, isActive: boolean): Promise<void> {
      await prisma.campaign.update({ where: { id }, data: { isActive } });
    },

    async softDelete(id: string): Promise<void> {
      await prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async findById(id: string): Promise<CampaignWithVariants | null> {
      return (await prisma.campaign.findFirst({
        where: { id, deletedAt: null },
        include: { variants: true },
      })) as unknown as CampaignWithVariants | null;
    },

    async findActiveForEvent(
      programId: string,
      eventType: string,
    ): Promise<CampaignWithVariants[]> {
      const now = new Date();
      return (await prisma.campaign.findMany({
        where: {
          programId,
          type: eventType as never,
          isActive: true,
          deletedAt: null,
          OR: [
            { startsAt: null, endsAt: null },
            { startsAt: { lte: now }, endsAt: null },
            { startsAt: null, endsAt: { gte: now } },
            { startsAt: { lte: now }, endsAt: { gte: now } },
          ],
        },
        include: { variants: true },
      })) as unknown as CampaignWithVariants[];
    },

    async getApplicationCount(campaignId: string, memberId: string): Promise<number> {
      return await prisma.campaignApplication.count({
        where: { campaignId, memberId },
      });
    },

    async getTotalAwarded(campaignId: string): Promise<number> {
      const result = await prisma.campaignApplication.aggregate({
        where: { campaignId },
        _sum: { pointsAwarded: true },
      });
      return result._sum.pointsAwarded ?? 0;
    },

    async recordApplication(input: {
      campaignId: string;
      variantId?: string | null;
      memberId: string;
      eventId?: string;
      pointsAwarded: number;
      metadata?: Record<string, unknown>;
    }): Promise<{ id: string }> {
      return await prisma.campaignApplication.create({
        data: { ...input, metadata: asJson(input.metadata) },
        select: { id: true },
      });
    },

    async countEligibleMembers(programId: string): Promise<number> {
      return await prisma.member.count({
        where: { programId, deletedAt: null },
      });
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

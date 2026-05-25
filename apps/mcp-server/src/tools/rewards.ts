import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

const rewardTypeEnum = z
  .enum(["discount", "product", "gift_card", "experience", "donation", "coalition"])
  .optional();

export const RewardsCatalogSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  maxCost: z.number().int().min(0).optional(),
  type: rewardTypeEnum,
  availableOnly: z.boolean().optional().default(true),
});

export const RewardCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["discount", "product", "gift_card", "experience", "donation", "coalition"]),
  pointCost: z.number().int().min(1),
  stock: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
  availableFromDate: z.string().optional().describe("ISO datetime"),
  availableUntilDate: z.string().optional().describe("ISO datetime"),
  tierRestriction: z.array(z.string()).optional(),
});

export const RewardRedemptionStatsSchema = z.object({
  rewardId: z.string().optional().describe("Omit for aggregate stats across all rewards"),
  period: z.enum(["7d", "30d", "90d", "365d"]).optional().default("30d"),
});

export function registerRewardTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "rewards_catalog",
    "Browse the loyalty rewards catalog. Members redeem their points for these rewards.",
    RewardsCatalogSchema.shape,
    async (params) => {
      try {
        const result = await client.listRewards(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "reward_create",
    "Add a new item to the rewards catalog.",
    RewardCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createReward(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "reward_redemption_stats",
    "Get redemption statistics for a reward or all rewards.",
    RewardRedemptionStatsSchema.shape,
    async (params) => {
      try {
        const result = await client.getRedemptionStats(params.rewardId, params.period);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

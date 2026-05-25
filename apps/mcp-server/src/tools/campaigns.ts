import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

const CampaignType = z.enum([
  "bonus_points",
  "spend_and_get",
  "frequency",
  "milestone",
  "referral",
  "birthday",
  "flash_sale",
  "tier_upgrade_bonus",
]);

const CampaignStatus = z.enum(["active", "draft", "paused", "ended"]);

export const CampaignCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: CampaignType,
  startDate: z.string().describe("ISO datetime"),
  endDate: z.string().optional().describe("ISO datetime, omit for open-ended"),
  segmentId: z.string().optional().describe("Target segment ID; omit for all members"),
  rules: z.record(z.unknown()).describe("Type-specific rules object"),
  stackable: z.boolean().optional().default(false),
  budgetCap: z.number().optional().describe("Max total points for this campaign"),
  status: z.enum(["draft", "active"]).optional().default("draft"),
});

export const CampaignsListSchema = z.object({
  status: CampaignStatus.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export const CampaignGetSchema = z.object({
  campaignId: z.string().min(1),
});

export const CampaignActivateSchema = z.object({
  campaignId: z.string().min(1),
});

export const CampaignPauseSchema = z.object({
  campaignId: z.string().min(1),
  reason: z.string().optional().describe("Reason for pausing (for audit log)"),
});

export function registerCampaignTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "campaign_create",
    "Create a new loyalty campaign. Supports bonus points, spend-and-get, frequency, milestone, referral, birthday, flash sale, and tier upgrade bonus types.",
    CampaignCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createCampaign(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaigns_list",
    "List campaigns with optional status filter. Returns active, draft, paused, and ended campaigns.",
    CampaignsListSchema.shape,
    async (params) => {
      try {
        const result = await client.listCampaigns(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaign_get",
    "Get detailed information and performance stats for a specific campaign.",
    CampaignGetSchema.shape,
    async (params) => {
      try {
        const campaign = await client.getCampaign(params.campaignId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(campaign, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaign_activate",
    "Activate a draft or paused campaign. The campaign will start processing events immediately.",
    CampaignActivateSchema.shape,
    async (params) => {
      try {
        const result = await client.activateCampaign(params.campaignId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaign_pause",
    "Pause an active campaign. It can be reactivated later.",
    CampaignPauseSchema.shape,
    async (params) => {
      try {
        const result = await client.pauseCampaign(params.campaignId, params.reason);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

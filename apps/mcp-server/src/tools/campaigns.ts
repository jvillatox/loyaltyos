import {
  campaignCreateBodySchema,
  campaignLifecycleSchema,
  campaignListQuerySchema,
} from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const campaignTypeSchema = z.enum([
  "BONUS_POINTS",
  "SPEND_AND_GET",
  "FREQUENCY",
  "MILESTONE",
  "REFERRAL",
  "BIRTHDAY",
  "ANNIVERSARY",
  "FLASH_SALE",
  "TIER_UPGRADE_BONUS",
]);

const campaignCreateInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: campaignTypeSchema,
  conditions: z.record(z.unknown()).optional(),
  multiplier: z.number().min(0).optional(),
  maxBudget: z.number().int().optional(),
  maxUsesPerMember: z.number().int().optional(),
  isStackable: z.boolean().optional(),
  abTesting: z.boolean().optional(),
  startsAt: z.string().optional().describe("ISO datetime"),
  endsAt: z.string().optional().describe("ISO datetime, omit for open-ended"),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        trafficPct: z.number().min(0).max(100),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const campaignsListInputSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .describe('Filter by active status ("true"/"false")'),
});

const campaignIdSchema = z.object({
  campaignId: z.string().min(1).describe("Campaign UUID"),
});

const campaignActivateInputSchema = campaignIdSchema.extend({
  action: z.literal("activate"),
});

const campaignPauseInputSchema = campaignIdSchema.extend({
  action: z.literal("pause"),
});

export function registerCampaignTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "campaign_create",
    method: "POST",
    path: "/api/v1/admin/campaigns",
    permission: "campaigns.write",
    inputSchema: campaignCreateInputSchema,
    requestSchema: campaignCreateBodySchema,
  });
  server.tool(
    "campaign_create",
    "Create a loyalty campaign. Supports bonus points, spend-and-get, frequency, milestone, referral, birthday, anniversary, flash sale, and tier upgrade bonus types.",
    campaignCreateInputSchema.shape,
    async (params) => {
      try {
        const result = await client.post("/api/v1/admin/campaigns", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "campaigns_list",
    method: "GET",
    path: "/api/v1/admin/campaigns",
    permission: "read",
    inputSchema: campaignsListInputSchema,
    requestSchema: campaignListQuerySchema,
  });
  server.tool(
    "campaigns_list",
    "List campaigns with optional pagination and active-status filter.",
    campaignsListInputSchema.shape,
    async (params) => {
      try {
        const result = await client.get("/api/v1/admin/campaigns", { params });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "campaign_get",
    method: "GET",
    path: "/api/v1/admin/campaigns/:id",
    permission: "read",
    inputSchema: campaignIdSchema,
    pathParams: ["campaignId"],
  });
  server.tool(
    "campaign_get",
    "Get a campaign's full configuration by id.",
    campaignIdSchema.shape,
    async ({ campaignId }) => {
      try {
        const result = await client.get(`/api/v1/admin/campaigns/${campaignId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "campaign_activate",
    method: "POST",
    path: "/api/v1/admin/campaigns/:id/lifecycle",
    permission: "campaigns.write",
    inputSchema: campaignActivateInputSchema,
    requestSchema: campaignLifecycleSchema,
    pathParams: ["campaignId"],
  });
  server.tool(
    "campaign_activate",
    "Activate a draft or paused campaign so it starts processing events.",
    campaignActivateInputSchema.shape,
    async ({ campaignId, action }) => {
      try {
        const result = await client.post(`/api/v1/admin/campaigns/${campaignId}/lifecycle`, {
          action,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "campaign_pause",
    method: "POST",
    path: "/api/v1/admin/campaigns/:id/lifecycle",
    permission: "campaigns.write",
    inputSchema: campaignPauseInputSchema,
    requestSchema: campaignLifecycleSchema,
    pathParams: ["campaignId"],
  });
  server.tool(
    "campaign_pause",
    "Pause an active campaign. It can be reactivated later.",
    campaignPauseInputSchema.shape,
    async ({ campaignId, action }) => {
      try {
        const result = await client.post(`/api/v1/admin/campaigns/${campaignId}/lifecycle`, {
          action,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

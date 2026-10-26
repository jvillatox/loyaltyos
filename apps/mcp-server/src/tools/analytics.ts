import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const analyticsDashboardInputSchema = z.object({});

const analyticsCampaignInputSchema = z.object({
  campaignId: z.string().min(1).describe("Campaign UUID"),
});

export function registerAnalyticsTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "analytics_dashboard",
    method: "GET",
    path: "/api/v1/admin/stats/dashboard",
    permission: "read",
    inputSchema: analyticsDashboardInputSchema,
  });
  server.tool(
    "analytics_dashboard",
    "Get program-level loyalty analytics: active members, points issued/redeemed, redemption ratio, recent transactions, and campaign counts.",
    analyticsDashboardInputSchema.shape,
    async () => {
      try {
        const result = await client.get("/api/v1/admin/stats/dashboard");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "analytics_campaign",
    method: "GET",
    path: "/api/v1/admin/campaigns/:id/stats",
    permission: "read",
    inputSchema: analyticsCampaignInputSchema,
    pathParams: ["campaignId"],
  });
  server.tool(
    "analytics_campaign",
    "Get per-campaign analytics: applications, points awarded, unique members, and a per-variant breakdown.",
    analyticsCampaignInputSchema.shape,
    async ({ campaignId }) => {
      try {
        const result = await client.get(`/api/v1/admin/campaigns/${campaignId}/stats`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

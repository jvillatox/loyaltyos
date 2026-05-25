import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const AnalyticsDashboardSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "365d"]).optional().default("30d"),
});

export const AnalyticsCampaignSchema = z.object({
  campaignId: z.string().min(1),
  period: z.enum(["7d", "30d", "all"]).optional().default("all"),
});

export function registerAnalyticsTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "analytics_dashboard",
    "Get the main program KPIs: active members, points issued, points redeemed, redemption rate, and top campaigns.",
    AnalyticsDashboardSchema.shape,
    async (params) => {
      try {
        const result = await client.getDashboard(params.period);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "analytics_campaign",
    "Get detailed performance metrics for a specific campaign.",
    AnalyticsCampaignSchema.shape,
    async (params) => {
      try {
        const result = await client.getCampaignStats(params.campaignId, params.period);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

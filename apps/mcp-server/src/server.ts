import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LoyaltyOSClient } from "./client.js";
import { registerResources } from "./resources.js";
import {
  registerAnalyticsTools,
  registerCampaignTools,
  registerCoalitionTools,
  registerCouponTools,
  registerGiftCardTools,
  registerMemberTools,
  registerProgramTools,
  registerRewardTools,
  registerSegmentTools,
} from "./tools/index.js";

export function createMcpServer(client: LoyaltyOSClient): McpServer {
  const server = new McpServer({
    name: "loyaltyos",
    version: "1.0.0",
  });

  registerMemberTools(server, client);
  registerCampaignTools(server, client);
  registerSegmentTools(server, client);
  registerAnalyticsTools(server, client);
  registerCouponTools(server, client);
  registerGiftCardTools(server, client);
  registerRewardTools(server, client);
  registerCoalitionTools(server, client);
  registerProgramTools(server, client);
  registerResources(server, client);

  return server;
}

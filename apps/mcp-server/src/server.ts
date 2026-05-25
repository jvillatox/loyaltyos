import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LoyaltyOSClient } from "./client.js";
import {
  registerAnalyticsTools,
  registerCampaignTools,
  registerCouponTools,
  registerMemberTools,
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

  return server;
}

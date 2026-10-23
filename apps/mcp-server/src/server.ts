import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LoyaltyOSClient } from "./client.js";
import { registerResources } from "./resources.js";
import {
  registerCampaignTools,
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
  registerCouponTools(server, client);
  registerGiftCardTools(server, client);
  registerRewardTools(server, client);
  registerProgramTools(server, client);
  registerResources(server, client);

  return server;
}

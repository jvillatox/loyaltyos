import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const ProgramConfigGetSchema = z.object({});

export const WebhooksListSchema = z.object({});

export function registerProgramTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "program_config_get",
    "Get the current loyalty program configuration including tier structure, point rules, and active integrations.",
    ProgramConfigGetSchema.shape,
    async () => {
      try {
        const result = await client.getProgramConfig();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "webhooks_list",
    "List configured webhooks for the loyalty program. Webhooks fire on events like point earn, redemption, tier change.",
    WebhooksListSchema.shape,
    async () => {
      try {
        const result = await client.listWebhooks();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const programConfigGetInputSchema = z.object({});

const webhooksListInputSchema = z.object({});

export function registerProgramTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "program_config_get",
    method: "GET",
    path: "/api/v1/admin/programs/:id",
    permission: "read",
    inputSchema: programConfigGetInputSchema,
  });
  server.tool(
    "program_config_get",
    "Get the current program configuration. Composes the admin's own program (via /admin/me), its details (/admin/programs/:id), and its tier list (/admin/tiers) into one result.",
    programConfigGetInputSchema.shape,
    async () => {
      try {
        const me = await client.get<{ data: { programId: string } }>("/api/v1/admin/me");
        const programId = me.data.programId;
        const [program, tiers] = await Promise.all([
          client.get(`/api/v1/admin/programs/${programId}`),
          client.get("/api/v1/admin/tiers"),
        ]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ program, tiers }, null, 2),
            },
          ],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "webhooks_list",
    method: "GET",
    path: "/api/v1/admin/webhooks",
    permission: "webhooks.manage",
    inputSchema: webhooksListInputSchema,
  });
  server.tool(
    "webhooks_list",
    "List configured webhooks for the loyalty program.",
    webhooksListInputSchema.shape,
    async () => {
      try {
        const result = await client.get("/api/v1/admin/webhooks");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

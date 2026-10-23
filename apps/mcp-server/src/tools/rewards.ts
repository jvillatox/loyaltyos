import { rewardCreateBodySchema, rewardListQuerySchema } from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const rewardsCatalogInputSchema = z.object({
  category: z.string().optional().describe("Reward category"),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .describe('Filter by active status ("true"/"false")'),
  minPoints: z.number().int().min(0).optional().describe("Minimum point cost"),
  maxPoints: z.number().int().min(0).optional().describe("Maximum point cost"),
  tierRequired: z.string().optional().describe("Tier id required to redeem"),
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (max 100)"),
});

const rewardCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  pointsCost: z.number().int().min(1),
  stock: z.number().int().min(0).optional(),
  imageUrl: z.string().optional(),
  category: z
    .enum([
      "DISCOUNT_FUTURE",
      "PHYSICAL_PRODUCT",
      "GIFT_CARD",
      "EXPERIENCE",
      "CHARITY_DONATION",
      "COALITION_TRANSFER",
    ])
    .optional(),
  tierRequired: z.string().optional(),
});

export function registerRewardTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "rewards_catalog",
    method: "GET",
    path: "/api/v1/admin/rewards",
    permission: "read",
    inputSchema: rewardsCatalogInputSchema,
    requestSchema: rewardListQuerySchema,
  });
  server.tool(
    "rewards_catalog",
    "List the rewards catalog with optional category, active-status, point-cost, and tier filters.",
    rewardsCatalogInputSchema.shape,
    async (params) => {
      try {
        const result = await client.get("/api/v1/admin/rewards", { params });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "reward_create",
    method: "POST",
    path: "/api/v1/admin/rewards",
    permission: "rewards.write",
    inputSchema: rewardCreateInputSchema,
    requestSchema: rewardCreateBodySchema,
  });
  server.tool(
    "reward_create",
    "Add a new item to the rewards catalog. Points are spent via pointsCost (not a discount percentage).",
    rewardCreateInputSchema.shape,
    async (params) => {
      try {
        const result = await client.post("/api/v1/admin/rewards", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

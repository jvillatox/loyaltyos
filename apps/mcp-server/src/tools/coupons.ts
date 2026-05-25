import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

const CouponType = z.enum([
  "percent_off",
  "amount_off",
  "free_product",
  "free_shipping",
  "bonus_points",
]);

const CouponMode = z.enum(["single_code", "unique_per_member", "limited_pool"]);

export const CouponCreateSchema = z.object({
  name: z.string().min(1),
  type: CouponType,
  value: z.number(),
  mode: CouponMode,
  code: z.string().optional().describe("For single_code mode; auto-generated if omitted"),
  quantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("For unique_per_member or limited_pool modes"),
  expiresAt: z.string().optional().describe("ISO datetime"),
  minPurchaseAmount: z.number().optional(),
  maxUsesPerMember: z.number().int().min(1).optional().default(1),
  segmentId: z.string().optional().describe("Restrict to segment"),
});

export function registerCouponTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "coupon_create",
    "Create a coupon or batch of unique coupons. Supports percentage discount, fixed amount, free product, free shipping, and bonus points types.",
    CouponCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createCoupon(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

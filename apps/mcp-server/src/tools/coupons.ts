import { couponCreateBodySchema } from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const couponCreateInputSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/),
  mode: z.enum(["SHARED", "INDIVIDUAL", "LIMITED"]),
  discountType: z.enum([
    "PERCENTAGE",
    "FIXED",
    "FREE_PRODUCT",
    "FREE_SHIPPING",
    "EXTRA_POINTS",
    "EXPERIENCE",
  ]),
  discountValue: z.number().min(0).optional(),
  minPurchase: z.number().int().min(0).optional(),
  maxUses: z.number().int().min(1).optional(),
  maxUsesPerMember: z.number().int().min(1).optional(),
  isStackable: z.boolean().optional(),
  channels: z.array(z.string().min(1)).optional(),
  startsAt: z.string().optional().describe("ISO datetime"),
  expiresAt: z.string().optional().describe("ISO datetime"),
});

export function registerCouponTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "coupon_create",
    method: "POST",
    path: "/api/v1/admin/coupons",
    permission: "coupons.write",
    inputSchema: couponCreateInputSchema,
    requestSchema: couponCreateBodySchema,
  });
  server.tool(
    "coupon_create",
    "Create a coupon. Supports percentage, fixed amount, free product, free shipping, extra points, and experience discount types.",
    couponCreateInputSchema.shape,
    async (params) => {
      try {
        const result = await client.post("/api/v1/admin/coupons", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

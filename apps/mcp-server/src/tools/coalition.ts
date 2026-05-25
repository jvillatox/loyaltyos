import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const CoalitionBalanceSchema = z.object({
  memberId: z.string().min(1),
});

export const CoalitionAccumulateSchema = z.object({
  memberId: z.string().min(1),
  points: z.number().int().min(1),
  transactionRef: z.string().min(1).describe("Idempotency key from POS/ecommerce"),
  metadata: z
    .object({})
    .passthrough()
    .optional()
    .describe("Purchase context (amount, store, etc.)"),
});

export const CoalitionConvertSchema = z.object({
  memberId: z.string().min(1),
  ownPoints: z.number().int().min(1).describe("Points to convert from LoyaltyOS balance"),
});

export function registerCoalitionTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "coalition_balance",
    "Get a member's balance in the external coalition system (e.g., Puntos Apprecio).",
    CoalitionBalanceSchema.shape,
    async (params) => {
      try {
        const result = await client.getCoalitionBalance(params.memberId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "coalition_accumulate",
    "Send points to the coalition system on behalf of a member (e.g., after a purchase that earns Puntos Apprecio).",
    CoalitionAccumulateSchema.shape,
    async (params) => {
      try {
        const { memberId, points, transactionRef, metadata } = params;
        const result = await client.accumulateCoalition(memberId, points, transactionRef, metadata);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "coalition_convert",
    "Convert a member's own loyalty points into coalition points (e.g., exchange LoyaltyOS points for Puntos Apprecio).",
    CoalitionConvertSchema.shape,
    async (params) => {
      try {
        const result = await client.convertCoalition(params.memberId, params.ownPoints);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

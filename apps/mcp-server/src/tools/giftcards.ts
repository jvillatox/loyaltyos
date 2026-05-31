import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const GiftCardCreateBatchSchema = z.object({
  name: z.string().min(1).max(200).describe("Batch name"),
  quantity: z.number().int().min(1).max(1_000_000).describe("Number of cards to generate"),
  initialAmount: z.number().positive().describe("Initial balance per card"),
  currency: z.string().length(3).default("MXN").describe("ISO 4217 currency code"),
  prefix: z.string().max(8).optional().describe("Optional prefix for generated codes"),
  expirationDate: z.string().describe("ISO datetime when cards expire"),
  termsTemplateId: z.string().min(1).describe("Terms & Conditions template ID"),
});

export const GiftCardRedeemSchema = z.object({
  code: z.string().min(1).describe("Gift card code (dashes optional)"),
  amount: z.number().positive().describe("Amount to redeem"),
  memberId: z.string().optional().describe("Member ID redeeming the card"),
  orderRef: z.string().optional().describe("External order reference"),
});

export function registerGiftCardTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "giftcards_create_batch",
    "Create a batch of gift cards. Generates unique 16-character codes with embedded HMAC checksums. Cards are generated asynchronously — use giftcards_batch_status to track progress.",
    GiftCardCreateBatchSchema.shape,
    async (params) => {
      try {
        const result = await client.createGiftCardBatch({
          ...params,
          expirationDate: new Date(params.expirationDate).toISOString(),
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "giftcards_batch_status",
    "Check the status of a gift card batch. Returns batch details including status (pending/generating/ready/partial/failed/cancelled), generated count, and card statistics.",
    { batchId: z.string().describe("Batch ID") },
    async ({ batchId }) => {
      try {
        const result = await client.getGiftCardBatch(batchId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "giftcards_redeem",
    "Redeem a gift card. Deducts the specified amount from the card balance. Requires Idempotency-Key header for safe retries. Returns the new balance and transaction ID.",
    GiftCardRedeemSchema.shape,
    async (params) => {
      try {
        const { code, amount, memberId, orderRef } = params;
        const result = await client.redeemGiftCard(code, { amount, memberId, orderRef });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "giftcards_lookup",
    "Look up a gift card by code. Returns whether the code is valid, current balance, currency, expiration date, and status. Does not modify the card.",
    { code: z.string().describe("Gift card code (dashes optional)") },
    async ({ code }) => {
      try {
        const result = await client.lookupGiftCard(code);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

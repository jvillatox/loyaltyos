import { giftcardLookupBodySchema } from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const giftCardBatchStatusInputSchema = z.object({
  batchId: z.string().min(1).describe("Gift card batch UUID"),
});

const giftCardLookupInputSchema = z.object({
  code: z.string().min(1).describe("Gift card code (dashes optional)"),
});

export function registerGiftCardTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "giftcards_batch_status",
    method: "GET",
    path: "/api/v1/admin/giftcards/batches/:id",
    permission: "read",
    inputSchema: giftCardBatchStatusInputSchema,
    pathParams: ["batchId"],
  });
  server.tool(
    "giftcards_batch_status",
    "Get a gift card batch's status and details (status, generated count, card statistics).",
    giftCardBatchStatusInputSchema.shape,
    async ({ batchId }) => {
      try {
        const result = await client.get(`/api/v1/admin/giftcards/batches/${batchId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "giftcards_lookup",
    method: "POST",
    path: "/api/v1/admin/giftcards/lookup",
    permission: "read",
    inputSchema: giftCardLookupInputSchema,
    requestSchema: giftcardLookupBodySchema,
  });
  server.tool(
    "giftcards_lookup",
    "Look up a gift card by code and return its balance, currency, expiration, and status. Does not modify the card. The code is masked unless the caller may reveal codes.",
    giftCardLookupInputSchema.shape,
    async ({ code }) => {
      try {
        const result = await client.post("/api/v1/admin/giftcards/lookup", { code });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

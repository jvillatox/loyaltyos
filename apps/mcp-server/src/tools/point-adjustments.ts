import { randomUUID } from "node:crypto";

import {
  ADJUSTMENT_REASON_CATEGORIES,
  memberAdjustBodySchema,
  pointAdjustmentsListQuerySchema,
} from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const adjustPointsInputSchema = z.object({
  memberId: z.string().min(1).describe("Member UUID"),
  amount: z
    .number()
    .int()
    .refine((amount) => amount !== 0, "amount must be non-zero")
    .describe("Points to add (positive) or deduct (negative). Must be non-zero."),
  reasonCategory: z.enum(ADJUSTMENT_REASON_CATEGORIES).describe("Why the points are changing."),
  comment: z.string().min(10).max(1000).describe("Justification (at least 10 characters)."),
  idempotencyKey: z
    .string()
    .optional()
    .describe("Optional idempotency key; a UUID is generated and returned if omitted."),
});

const pointAdjustmentsListInputSchema = z.object({
  status: z
    .enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"])
    .optional()
    .describe("Filter by request status"),
  memberId: z.string().optional().describe("Filter by member UUID"),
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (max 100)"),
});

interface AdjustPointsResponse {
  data: {
    requestId: string;
    status: "APPROVED" | "PENDING";
    transactionId?: string;
    amount?: number;
    balanceAfter?: number;
  };
}

export function registerPointAdjustmentTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "member_adjust_points",
    method: "POST",
    path: "/api/v1/members/:id/adjust",
    permission: "members.write",
    inputSchema: adjustPointsInputSchema,
    requestSchema: memberAdjustBodySchema,
    pathParams: ["memberId"],
    headerParams: ["idempotencyKey"],
  });
  server.tool(
    "member_adjust_points",
    "Adjust a member's point balance. Points are added with a positive amount or deducted with a negative amount. This moves real points, so before calling confirm the amount, the member, and the reason with the user. Requires a reason category and a comment of at least 10 characters. An OPERATOR adjustment over the program's per-transaction or daily cap is sent for approval instead of applied; a SUPER_ADMIN applies directly with no cap. Returns the idempotency key and whether the adjustment was applied immediately (with the resulting balance) or sent for approval.",
    adjustPointsInputSchema.shape,
    async ({ memberId, amount, reasonCategory, comment, idempotencyKey }) => {
      try {
        const key = idempotencyKey ?? randomUUID();
        const result = await client.post<AdjustPointsResponse>(
          `/api/v1/members/${memberId}/adjust`,
          { amount, reasonCategory, comment },
          { headers: { "Idempotency-Key": key } },
        );

        const { data } = result;
        const outcome = data.status === "APPROVED" ? "applied" : "sent_for_approval";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ idempotencyKey: key, outcome, ...data }, null, 2),
            },
          ],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "point_adjustments_list",
    method: "GET",
    path: "/api/v1/admin/point-adjustments",
    permission: "read",
    inputSchema: pointAdjustmentsListInputSchema,
    requestSchema: pointAdjustmentsListQuerySchema,
  });
  server.tool(
    "point_adjustments_list",
    "List point adjustment requests, filterable by status and member. Read-only — approving or rejecting a request is done by a person in the admin UI, not by this tool.",
    pointAdjustmentsListInputSchema.shape,
    async (params) => {
      try {
        const result = await client.get("/api/v1/admin/point-adjustments", { params });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

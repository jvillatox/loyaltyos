import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const MemberGetSchema = z.object({
  memberId: z.string().min(1).describe("Member UUID or email address"),
});

export const MembersListSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  tier: z.enum(["bronze", "silver", "gold", "platinum"]).optional(),
  inactiveDays: z.number().int().min(0).optional(),
  minBalance: z.number().int().min(0).optional(),
  maxBalance: z.number().int().min(0).optional(),
  search: z.string().optional(),
});

export const MemberPointsHistorySchema = z.object({
  memberId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  type: z.enum(["earn", "burn", "expire", "adjust"]).optional(),
  startDate: z.string().optional().describe("ISO date string"),
  endDate: z.string().optional().describe("ISO date string"),
});

export const MemberAdjustPointsSchema = z.object({
  memberId: z.string().min(1),
  amount: z.number().describe("Positive to add points, negative to deduct"),
  note: z.string().min(10).describe("Audit note explaining the adjustment reason"),
  idempotencyKey: z.string().uuid().optional().describe("Deduplicate concurrent calls"),
});

export const MemberBadgesSchema = z.object({
  memberId: z.string().min(1),
  includeProgress: z.boolean().optional().default(false),
});

export function registerMemberTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "member_get",
    "Get a loyalty program member's full profile including tier, point balance, and activity summary",
    MemberGetSchema.shape,
    async (params) => {
      try {
        const member = await client.getMember(params.memberId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(member, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "members_list",
    "List loyalty program members with optional filters. Use to find members matching specific criteria.",
    MembersListSchema.shape,
    async (params) => {
      try {
        const result = await client.listMembers(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "member_points_history",
    "Get the point transaction history for a member. Shows all earn and burn events.",
    MemberPointsHistorySchema.shape,
    async (params) => {
      try {
        const { memberId, ...filters } = params;
        const result = await client.getMemberTransactions(memberId, filters);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "member_adjust_points",
    "Manually adjust a member's point balance. Requires an audit note explaining the reason.",
    MemberAdjustPointsSchema.shape,
    async (params) => {
      try {
        const { memberId, amount, note, idempotencyKey } = params;
        const result = await client.adjustMemberPoints(memberId, amount, note, idempotencyKey);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "member_badges",
    "Get all badges earned by a member, including locked badges showing progress.",
    MemberBadgesSchema.shape,
    async (params) => {
      try {
        const result = await client.getMemberBadges(params.memberId, params.includeProgress);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

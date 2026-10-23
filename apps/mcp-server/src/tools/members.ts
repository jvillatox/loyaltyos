import { memberListQuerySchema, memberTransactionsQuerySchema } from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const memberIdSchema = z.object({
  memberId: z.string().min(1).describe("Member UUID"),
});

const membersListInputSchema = z.object({
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (max 100)"),
  search: z
    .string()
    .optional()
    .describe("Search by email, first/last name, or external id (case-insensitive)"),
});

const memberPointsHistoryInputSchema = z.object({
  memberId: z.string().min(1).describe("Member UUID"),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export function registerMemberTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "member_get",
    method: "GET",
    path: "/api/v1/members/:id",
    permission: "read",
    inputSchema: memberIdSchema,
    pathParams: ["memberId"],
  });
  server.tool(
    "member_get",
    "Get a member's profile by id, including point balance, tier, and activity metadata.",
    memberIdSchema.shape,
    async ({ memberId }) => {
      try {
        const result = await client.get(`/api/v1/members/${memberId}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "members_list",
    method: "GET",
    path: "/api/v1/members",
    permission: "read",
    inputSchema: membersListInputSchema,
    requestSchema: memberListQuerySchema,
  });
  server.tool(
    "members_list",
    "List members with optional search and pagination (page/pageSize).",
    membersListInputSchema.shape,
    async (params) => {
      try {
        const result = await client.get("/api/v1/members", { params });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "member_points_history",
    method: "GET",
    path: "/api/v1/members/:id/transactions",
    permission: "read",
    inputSchema: memberPointsHistoryInputSchema,
    requestSchema: memberTransactionsQuerySchema,
    pathParams: ["memberId"],
  });
  server.tool(
    "member_points_history",
    "Get a member's point transaction history, paginated with page/pageSize.",
    memberPointsHistoryInputSchema.shape,
    async ({ memberId, page, pageSize }) => {
      try {
        const result = await client.get(`/api/v1/members/${memberId}/transactions`, {
          params: { page, pageSize },
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "member_badges",
    method: "GET",
    path: "/api/v1/members/:id/badges",
    permission: "read",
    inputSchema: memberIdSchema,
    pathParams: ["memberId"],
  });
  server.tool(
    "member_badges",
    "Get all badges earned by a member, including locked badges with progress.",
    memberIdSchema.shape,
    async ({ memberId }) => {
      try {
        const result = await client.get(`/api/v1/members/${memberId}/badges`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

import { segmentCreateBodySchema, segmentEstimateBodySchema } from "@loyaltyos/api-contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { registerContract } from "../contracts.js";
import { mapAxiosError } from "../errors.js";

const segmentRuleConditionInput = z.object({
  field: z.string().min(1),
  eq: z.unknown().optional(),
  neq: z.unknown().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  in: z.array(z.unknown()).optional(),
  between: z.tuple([z.number(), z.number()]).optional(),
  contains: z.string().optional(),
});

const segmentRuleGroupInput: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    all: z.array(z.union([segmentRuleConditionInput, segmentRuleGroupInput])).optional(),
    any: z.array(z.union([segmentRuleConditionInput, segmentRuleGroupInput])).optional(),
  }),
);

const segmentCreateInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["STATIC", "DYNAMIC"]),
  rules: segmentRuleGroupInput.optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

const segmentsListInputSchema = z.object({});

const segmentEstimateInputSchema = z.object({
  rules: segmentRuleGroupInput.optional(),
});

export function registerSegmentTools(server: McpServer, client: LoyaltyOSClient): void {
  registerContract({
    name: "segment_create",
    method: "POST",
    path: "/api/v1/admin/segments",
    permission: "segments.write",
    inputSchema: segmentCreateInputSchema,
    requestSchema: segmentCreateBodySchema,
  });
  server.tool(
    "segment_create",
    "Create a static or dynamic customer segment. Dynamic segments auto-update as member data changes.",
    segmentCreateInputSchema.shape,
    async (params) => {
      try {
        const result = await client.post("/api/v1/admin/segments", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "segments_list",
    method: "GET",
    path: "/api/v1/admin/segments",
    permission: "read",
    inputSchema: segmentsListInputSchema,
  });
  server.tool(
    "segments_list",
    "List all segments with their current member counts.",
    segmentsListInputSchema.shape,
    async () => {
      try {
        const result = await client.get("/api/v1/admin/segments");
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  registerContract({
    name: "segment_preview",
    method: "POST",
    path: "/api/v1/admin/segments/estimate",
    permission: "read",
    inputSchema: segmentEstimateInputSchema,
    requestSchema: segmentEstimateBodySchema,
  });
  server.tool(
    "segment_preview",
    "Estimate how many members match a set of rules before creating a segment. Use this to validate the audience size.",
    segmentEstimateInputSchema.shape,
    async (params) => {
      try {
        const result = await client.post("/api/v1/admin/segments/estimate", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}

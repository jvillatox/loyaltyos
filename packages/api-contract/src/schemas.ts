import { z } from "zod";

/**
 * Request schemas shared by the API and the MCP server. Each schema is the
 * exact Zod object the API route parses from `request.body` or `request.query`
 * (minus the server-injected `programId`, which is never part of a client
 * request). The MCP server reuses these as its tool input schemas so the two
 * sides cannot drift: a field the API ignores would also be ignored here.
 */

// ── Campaigns ──────────────────────────────────────────────────────────────

export const campaignCreateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "BONUS_POINTS",
    "SPEND_AND_GET",
    "FREQUENCY",
    "MILESTONE",
    "REFERRAL",
    "BIRTHDAY",
    "ANNIVERSARY",
    "FLASH_SALE",
    "TIER_UPGRADE_BONUS",
  ]),
  conditions: z.record(z.unknown()).optional(),
  multiplier: z.number().min(0).optional(),
  maxBudget: z.number().int().optional(),
  maxUsesPerMember: z.number().int().optional(),
  isStackable: z.boolean().optional(),
  abTesting: z.boolean().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        trafficPct: z.number().min(0).max(100),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

export const campaignLifecycleSchema = z.object({
  action: z.enum(["activate", "pause", "archive"]),
});

export const campaignListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return undefined;
    }),
});

// ── Segments ───────────────────────────────────────────────────────────────

export const segmentRuleConditionSchema = z.object({
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

export const segmentRuleGroupSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    all: z.array(z.union([segmentRuleConditionSchema, segmentRuleGroupSchema])).optional(),
    any: z.array(z.union([segmentRuleConditionSchema, segmentRuleGroupSchema])).optional(),
  }),
);

export const segmentCreateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["STATIC", "DYNAMIC"]),
  rules: segmentRuleGroupSchema.optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

export const segmentEstimateBodySchema = z.object({
  rules: segmentRuleGroupSchema.optional(),
});

// ── Coupons ────────────────────────────────────────────────────────────────

export const couponCreateBodySchema = z.object({
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
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

// ── Gift cards ─────────────────────────────────────────────────────────────

export const giftcardLookupBodySchema = z.object({
  code: z.string().min(1),
});

// ── Rewards ────────────────────────────────────────────────────────────────

export const rewardCreateBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  pointsCost: z.number().int().min(1),
  stock: z.number().int().min(0).optional().nullable(),
  imageUrl: z.string().url().optional().or(z.literal("")),
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

export const rewardListQuerySchema = z.object({
  category: z.string().optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => {
      if (v === "true") return true;
      if (v === "false") return false;
      return undefined;
    }),
  minPoints: z.coerce.number().int().min(0).optional(),
  maxPoints: z.coerce.number().int().min(0).optional(),
  tierRequired: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ── Members ────────────────────────────────────────────────────────────────

export const memberListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().optional(),
});

export const memberTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

import { z } from "zod";

const RuleOperand = z.union([z.string(), z.number(), z.boolean()]);

const RuleCondition: z.ZodType<unknown> = z.object({
  field: z.string().min(1),
  eq: RuleOperand.optional(),
  neq: RuleOperand.optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  in: z.array(RuleOperand).optional(),
  between: z.tuple([z.number(), z.number()]).optional(),
  contains: z.string().optional(),
});

const RuleGroup: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    all: z.array(z.union([RuleCondition, RuleGroup])).optional(),
    any: z.array(z.union([RuleCondition, RuleGroup])).optional(),
  }),
);

export const ruleDslSchema = RuleGroup;

export const campaignVariantSchema = z.object({
  name: z.string().min(1),
  trafficPct: z.number().min(0).max(100),
  config: z.record(z.unknown()).optional(),
});

export const campaignCreateSchema = z.object({
  programId: z.string().min(1),
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
  variants: z.array(campaignVariantSchema).optional(),
});

export const campaignUpdateSchema = campaignCreateSchema
  .omit({ programId: true, type: true })
  .partial();

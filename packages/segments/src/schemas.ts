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

export const segmentCreateSchema = z
  .object({
    programId: z.string().min(1),
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    type: z.enum(["STATIC", "DYNAMIC"]),
    rules: RuleGroup.optional(),
    memberIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "DYNAMIC" && !data.rules) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dynamic segments require rules",
        path: ["rules"],
      });
    }
  });

export const segmentUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  rules: RuleGroup.optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

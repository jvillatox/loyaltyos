import { z } from "zod";

import { ALLOWED_CATEGORIES } from "./types.js";

export const rewardCreateSchema = z.object({
  programId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  pointsCost: z.number().int().min(1),
  stock: z.number().int().min(0).optional().nullable(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  category: z.enum(ALLOWED_CATEGORIES).optional(),
  tierRequired: z.string().optional(),
});

export const rewardUpdateSchema = rewardCreateSchema.omit({ programId: true }).partial();

export const rewardListQuerySchema = z.object({
  category: z.enum(ALLOWED_CATEGORIES).optional(),
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

export const redeemSchema = z.object({
  rewardId: z.string().min(1),
  memberId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const restockSchema = z.object({
  qty: z.number().int().min(1),
});

export type RewardCreateInput = z.infer<typeof rewardCreateSchema>;
export type RewardUpdateInput = z.infer<typeof rewardUpdateSchema>;
export type RewardListQuery = z.infer<typeof rewardListQuerySchema>;

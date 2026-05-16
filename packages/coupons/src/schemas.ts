import { z } from "zod";

export const couponCreateSchema = z.object({
  programId: z.string().min(1),
  code: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, "Code must be uppercase alphanumeric with dashes/underscores"),
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

export const couponUpdateSchema = couponCreateSchema
  .omit({ programId: true, code: true, mode: true })
  .partial();

export const couponValidateSchema = z.object({
  code: z.string().min(1),
  memberId: z.string().min(1),
  purchaseAmount: z.number().min(0).optional(),
  channel: z.string().optional(),
});

export const generateCodesSchema = z.object({
  programId: z.string().min(1),
  prefix: z
    .string()
    .max(10)
    .regex(/^[A-Z0-9]*$/, "Prefix must be uppercase alphanumeric")
    .optional(),
  count: z.number().int().min(1).max(10000),
  length: z.number().int().min(6).max(20).optional().default(8),
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

export type CouponCreateInput = z.infer<typeof couponCreateSchema>;
export type CouponUpdateInput = z.infer<typeof couponUpdateSchema>;
export type GenerateCodesInput = z.infer<typeof generateCodesSchema>;

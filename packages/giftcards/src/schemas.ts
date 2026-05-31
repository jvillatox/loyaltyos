import { z } from "zod";

export const createBatchSchema = z.object({
  programId: z.string().min(1),
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(1_000_000),
  initialAmount: z.number().positive(),
  currency: z.string().length(3).default("MXN"),
  prefix: z
    .string()
    .max(8)
    .regex(/^[A-Z0-9]+$/)
    .optional(),
  expirationDate: z.coerce.date(),
  termsTemplateId: z.string().min(1),
  createdById: z.string().min(1),
});

export const createTermsTemplateSchema = z.object({
  programId: z.string().min(1),
  name: z.string().min(1).max(200),
  locale: z.string().default("es-MX"),
  body: z.string().min(1),
});

export const updateTermsTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  locale: z.string().optional(),
  body: z.string().min(1).optional(),
});

export const validateCodeSchema = z.object({
  code: z.string().min(1),
  programId: z.string().optional(),
});

export const redeemSchema = z.object({
  code: z.string().min(1),
  amount: z.number().positive(),
  memberId: z.string().optional(),
  idempotencyKey: z.string().min(1),
  orderRef: z.string().optional(),
  createdById: z.string().optional(),
  requestProgramId: z.string().min(1),
});

export const refundSchema = z.object({
  code: z.string().min(1),
  amount: z.number().positive(),
  idempotencyKey: z.string().min(1),
  reason: z.string().optional(),
  createdById: z.string().optional(),
  requestProgramId: z.string().min(1),
});

export const cancelCardSchema = z.object({
  code: z.string().min(1),
  createdById: z.string().optional(),
  requestProgramId: z.string().min(1),
});

export const exportSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  batchId: z.string().min(1),
});

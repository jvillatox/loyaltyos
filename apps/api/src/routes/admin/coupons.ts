import { CouponsService } from "@loyaltyos/coupons";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";

const coupons = new CouponsService(prisma);

const createSchema = z.object({
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

const updateSchema = createSchema.partial();

const generateSchema = z.object({
  prefix: z.string().max(10).optional(),
  count: z.number().int().min(1).max(10000),
  length: z.number().int().min(6).max(20).optional(),
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

export function adminCouponsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/coupons — Create coupon
  app.post("/admin/coupons", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const coupon = await coupons.create({
      ...body,
      programId: request.programId,
    });
    return reply.status(201).send({ data: coupon });
  });

  // POST /admin/coupons/generate — Generate bulk codes
  app.post("/admin/coupons/generate", async (request, reply) => {
    const body = generateSchema.parse(request.body);
    const codes = await coupons.generateCodes({
      ...body,
      programId: request.programId,
    });
    return reply.status(201).send({ data: codes });
  });

  // GET /admin/coupons — List coupons
  app.get("/admin/coupons", async (request, reply) => {
    const query = z
      .object({
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
        mode: z.enum(["SHARED", "INDIVIDUAL", "LIMITED"]).optional(),
      })
      .parse(request.query);

    const result = await coupons.list(request.programId, query);
    return reply.send({ data: result });
  });

  // GET /admin/coupons/:id — Get coupon by id
  app.get("/admin/coupons/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const coupon = await coupons.getById(id);
    return reply.send({ data: coupon });
  });

  // PATCH /admin/coupons/:id — Update coupon
  app.patch("/admin/coupons/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const coupon = await coupons.update(id, body);
    return reply.send({ data: coupon });
  });

  // DELETE /admin/coupons/:id — Soft delete coupon
  app.delete("/admin/coupons/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await coupons.delete(id);
    return reply.status(204).send();
  });

  // GET /admin/coupons/:id/stats — Usage statistics
  app.get("/admin/coupons/:id/stats", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const stats = await coupons.stats(id);
    return reply.send({ data: stats });
  });

  done();
}

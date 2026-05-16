import { CouponsService } from "@loyaltyos/coupons";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";

const coupons = new CouponsService(prisma);

const validateSchema = z.object({
  code: z.string().min(1),
  memberId: z.string().min(1),
  purchaseAmount: z.number().min(0).optional(),
  channel: z.string().optional(),
});

const redeemSchema = validateSchema;

export function couponsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /coupons/validate — Validate a coupon without redeeming
  app.post("/coupons/validate", async (request, reply) => {
    const body = validateSchema.parse(request.body);
    const result = await coupons.validate(body.code, {
      memberId: body.memberId,
      purchaseAmount: body.purchaseAmount,
      channel: body.channel,
    });
    return reply.send({ data: result });
  });

  // POST /coupons/redeem — Validate and redeem a coupon
  app.post("/coupons/redeem", async (request, reply) => {
    const body = redeemSchema.parse(request.body);
    const result = await coupons.redeem(body.code, {
      memberId: body.memberId,
      purchaseAmount: body.purchaseAmount,
      channel: body.channel,
    });
    return reply.send({ data: result });
  });

  done();
}

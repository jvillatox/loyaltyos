import type { RedisLockFn } from "@loyaltyos/giftcards";
import { createRedisLocks, normalizeCode } from "@loyaltyos/giftcards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { giftCardService } from "../lib/giftcard-setup.js";
import { getRedisConnection } from "../lib/queue.js";

// ── Zod schemas ──────────────────────────────────

const redeemBodySchema = z.object({
  amount: z.number().positive(),
  memberId: z.string().optional(),
  orderRef: z.string().optional(),
});

const refundBodySchema = z.object({
  amount: z.number().positive(),
  reason: z.string().optional(),
});

const transactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  type: z.enum(["activate", "redeem", "refund", "cancel", "expire"]).optional(),
});

// ── Redis lock (lazy init) ───────────────────────

let _redisLock: RedisLockFn | null = null;
function getRedisLock(): RedisLockFn {
  if (!_redisLock) {
    const redis = getRedisConnection();
    if (!redis) throw new Error("Redis not available for gift card locking");
    _redisLock = createRedisLocks(redis);
  }
  return _redisLock;
}

export function giftCardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  const prefix = "/giftcards";

  // ── Public endpoints ───────────────────────────

  // POST /giftcards/:code/validate — Validate code balance/status (10/min)
  app.post(
    `${prefix}/:code/validate`,
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { code } = z.object({ code: z.string().min(1) }).parse(request.params);
      const programId = request.programId || (request.headers["x-program-id"] as string);
      const result = await giftCardService.validateCode({ code, programId });
      return reply.send({ data: result });
    },
  );

  // POST /giftcards/:code/redeem — Redeem gift card (Idempotency-Key header required)
  app.post(`${prefix}/:code/redeem`, async (request, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.params);
    const body = redeemBodySchema.parse(request.body);

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_IDEMPOTENCY_KEY", message: "Idempotency-Key header is required" },
      });
    }

    const result = await giftCardService.redeem({ code, ...body, idempotencyKey }, getRedisLock());
    return reply.send({ data: result });
  });

  // ── Admin endpoints ────────────────────────────

  // POST /giftcards/:code/refund — Refund to gift card
  app.post(`${prefix}/:code/refund`, async (request, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.params);
    const body = refundBodySchema.parse(request.body);

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_IDEMPOTENCY_KEY", message: "Idempotency-Key header is required" },
      });
    }

    const result = await giftCardService.refund({ code, ...body, idempotencyKey });
    return reply.send({ data: result });
  });

  // POST /giftcards/:code/cancel — Cancel gift card
  app.post(`${prefix}/:code/cancel`, async (request, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.params);
    const card = await giftCardService.cancelCard({ code });
    return reply.send({ data: card });
  });

  // GET /giftcards/:code/transactions — List transactions for a gift card
  app.get(`${prefix}/:code/transactions`, async (request, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.params);
    const query = transactionsQuerySchema.parse(request.query);

    const normalized = normalizeCode(code);
    const card = await prisma.giftCard.findUnique({ where: { code: normalized } });
    if (!card) {
      return reply.status(404).send({
        error: { code: "GIFT_CARD_NOT_FOUND", message: "Gift card not found" },
      });
    }

    const result = await giftCardService.getTransactions(card.id, query);
    return reply.send({ data: result });
  });

  done();
}

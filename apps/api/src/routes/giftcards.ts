import type { RedisLockFn } from "@loyaltyos/giftcards";
import { createRedisLocks } from "@loyaltyos/giftcards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { giftCardService } from "../lib/giftcard-setup.js";
import { getRedisConnection } from "../lib/queue.js";

// ── Zod schemas ──────────────────────────────────

const validateBodySchema = z.object({
  code: z.string().min(1),
});

const redeemBodySchema = z.object({
  code: z.string().min(1),
  amount: z.number().positive(),
  memberId: z.string().optional(),
  orderRef: z.string().optional(),
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

  // ── Validate ──────────────────────────────────

  // POST /giftcards/validate — Validate code balance/status
  // Combined rate-limit key: IP + code prefix (H.1)
  // Public-bearer-by-design — no programId required (H.3)
  app.post(
    `${prefix}/validate`,
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req) => {
            const ip = req.ip;
            const codePrefix = (req.body as { code?: string }).code?.slice(0, 4) ?? "anon";
            return `validate:${ip}:${codePrefix}`;
          },
        },
      },
    },
    async (request, reply) => {
      const body = validateBodySchema.parse(request.body);
      const result = await giftCardService.validateCode({ code: body.code });
      return reply.send({ data: result });
    },
  );

  // ── Redeem ────────────────────────────────────

  // POST /giftcards/redeem — Redeem gift card (code in body — G.1)
  app.post(`${prefix}/redeem`, async (request, reply) => {
    const body = redeemBodySchema.parse(request.body);

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_IDEMPOTENCY_KEY", message: "Idempotency-Key header is required" },
      });
    }

    const result = await giftCardService.redeem(
      {
        code: body.code,
        amount: body.amount,
        memberId: body.memberId,
        orderRef: body.orderRef,
        idempotencyKey,
        createdById: request.memberId ?? undefined,
        requestProgramId: request.programId,
      },
      getRedisLock(),
    );
    return reply.send({ data: result });
  });

  done();
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { coalitionService, getCachedExternalBalance } from "../lib/coalition-setup.js";

// ── Schemas ────────────────────────────────────────────────────────

const accumulateSchema = z.object({
  memberId: z.string().min(1),
  externalMemberRef: z.string().min(1),
  points: z.number().int().positive(),
  txRef: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const redeemSchema = z.object({
  memberId: z.string().min(1),
  externalMemberRef: z.string().min(1),
  points: z.number().int().positive(),
  txRef: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const convertSchema = z.object({
  memberId: z.string().min(1),
  externalMemberRef: z.string().min(1),
  ownPoints: z.number().int().positive(),
  txRef: z.string().min(1),
});

const reverseSchema = z.object({
  txRef: z.string().min(1),
  reason: z.string().min(1),
});

// ── Routes ─────────────────────────────────────────────────────────

export function coalitionRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // ═══ Accumulate ═══

  app.post("/coalition/accumulate", async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
      });
    }

    const body = accumulateSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const result = await coalitionService.accumulate({
      programId,
      memberId: body.memberId,
      externalMemberRef: body.externalMemberRef,
      points: body.points,
      txRef: body.txRef,
      metadata: body.metadata,
    });

    return reply.status(result.idempotent ? 200 : 201).send({ data: result });
  });

  // ═══ Redeem ═══

  app.post("/coalition/redeem", async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
      });
    }

    const body = redeemSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const result = await coalitionService.redeem({
      programId,
      memberId: body.memberId,
      externalMemberRef: body.externalMemberRef,
      points: body.points,
      txRef: body.txRef,
      metadata: body.metadata,
    });

    return reply.status(result.idempotent ? 200 : 201).send({ data: result });
  });

  // ═══ Convert ═══

  app.post("/coalition/convert", async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
      });
    }

    const body = convertSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const result = await coalitionService.convert({
      programId,
      memberId: body.memberId,
      externalMemberRef: body.externalMemberRef,
      ownPoints: body.ownPoints,
      txRef: body.txRef,
    });

    return reply.status(result.idempotent ? 200 : 201).send({ data: result });
  });

  // ═══ Reverse ═══

  app.post("/coalition/reverse", async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
      });
    }

    const body = reverseSchema.parse(request.body);

    await coalitionService.reverseCoalitionTransaction(body.txRef, body.reason);

    return reply.status(200).send({ data: { txRef: body.txRef, reversed: true } });
  });

  // ═══ Member Balance ═══

  app.get("/members/:id/coalition/balance", async (request, reply) => {
    const { id: memberId } = z.object({ id: z.string() }).parse(request.params);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const balance = await getCachedExternalBalance(programId, memberId, () =>
      coalitionService.getExternalBalance(memberId, programId),
    );

    return reply.send({ data: { memberId, balance } });
  });

  // ═══ Member History ═══

  app.get("/members/:id/coalition/history", async (request, reply) => {
    const { id: memberId } = z.object({ id: z.string() }).parse(request.params);
    const programId = request.programId || (request.headers["x-program-id"] as string);

    const query = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(request.query);

    const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ?? new Date();

    const history = await coalitionService.getExternalHistory(memberId, programId, from, to);

    return reply.send({ data: history });
  });

  done();
}

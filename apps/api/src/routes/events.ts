import { PointsService } from "@loyaltyos/core";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";

const points = new PointsService(prisma);

const eventSchema = z.object({
  type: z.string().min(1),
  memberId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export function eventsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post("/events", async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
      });
    }

    const body = eventSchema.parse(request.body);

    // Deduplicate the event
    const existing = await prisma.event.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return reply.send({ data: existing, idempotent: true });
    }

    // Create event
    const event = await prisma.event.create({
      data: {
        programId: request.programId,
        type: body.type,
        memberId: body.memberId,
        payload: body.payload as Prisma.InputJsonValue,
        idempotencyKey,
        processed: false,
      },
    });

    // If the event is for a member and represents points-earning activity,
    // process it through the points engine
    if (body.memberId) {
      try {
        // For "purchase" events, earn points
        if (body.type === "purchase") {
          const amount =
            body.payload && typeof body.payload === "object" && "amount" in body.payload
              ? Number((body.payload as Record<string, number>).amount)
              : 0;

          if (amount > 0) {
            const result = await points.earn({
              memberId: body.memberId,
              programId: request.programId,
              amount,
              source: `event:${body.type}`,
              idempotencyKey: `${idempotencyKey}-earn`,
              metadata: body.payload,
            });

            await prisma.event.update({
              where: { id: event.id },
              data: {
                processed: true,
                processedAt: new Date(),
              },
            });

            return reply.status(201).send({ data: { event, earnResult: result } });
          }
        }

        // For "registration" events, grant sign-up bonus
        if (body.type === "registration") {
          const bonus = 500; // Default signup bonus
          const result = await points.earn({
            memberId: body.memberId,
            programId: request.programId,
            amount: bonus,
            source: "signup_bonus",
            idempotencyKey: `${idempotencyKey}-bonus`,
          });

          await prisma.event.update({
            where: { id: event.id },
            data: { processed: true, processedAt: new Date() },
          });

          return reply.status(201).send({ data: { event, earnResult: result } });
        }
      } catch (err) {
        await prisma.event.update({
          where: { id: event.id },
          data: { error: String(err) },
        });
        throw err;
      }
    }

    return reply.status(201).send({ data: event });
  });

  done();
}

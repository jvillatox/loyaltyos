import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { giftCardService } from "../../lib/giftcard-setup.js";

// ── Zod schemas ──────────────────────────────────

const createBatchRouteSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(1_000_000),
  initialAmount: z.number().positive(),
  currency: z.string().length(3).default("MXN"),
  prefix: z
    .string()
    .max(8)
    .regex(/^[A-Z0-9]*$/)
    .optional(),
  expirationDate: z.coerce.date(),
  termsTemplateId: z.string().min(1),
});

const updateTermsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  locale: z.string().optional(),
  body: z.string().min(1).optional(),
});

const createTermsRouteSchema = z.object({
  name: z.string().min(1).max(200),
  locale: z.string().default("es-MX"),
  body: z.string().min(1),
});

export function adminGiftCardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  const prefix = "/admin/giftcards";

  // ── Batches ──────────────────────────────────

  app.post(`${prefix}/batches`, async (request, reply) => {
    const body = createBatchRouteSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const batch = await giftCardService.createBatch({
      ...body,
      programId,
      createdById: request.adminId ?? "system",
    });
    return reply.status(201).send({ data: batch });
  });

  app.get(`${prefix}/batches`, async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        status: z
          .enum(["pending", "generating", "ready", "partial", "failed", "cancelled"])
          .optional(),
      })
      .parse(request.query);

    const programId = request.programId || (request.headers["x-program-id"] as string);
    const result = await giftCardService.listBatches(programId, query);
    return reply.send({ data: result });
  });

  app.get(`${prefix}/batches/:id`, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const batch = await giftCardService.getBatch(id);
    return reply.send({ data: batch });
  });

  app.post(`${prefix}/batches/:id/cancel`, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const batch = await giftCardService.cancelBatch(id);
    return reply.send({ data: batch });
  });

  // ── Terms templates ──────────────────────────

  app.post(`${prefix}/terms`, async (request, reply) => {
    const body = createTermsRouteSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const template = await giftCardService.createTermsTemplate({
      ...body,
      programId,
    });
    return reply.status(201).send({ data: template });
  });

  app.get(`${prefix}/terms`, async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const templates = await giftCardService.listTermsTemplates(programId);
    return reply.send({ data: templates });
  });

  app.get(`${prefix}/terms/:id`, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const template = await giftCardService.getTermsTemplate(id);
    return reply.send({ data: template });
  });

  app.patch(`${prefix}/terms/:id`, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateTermsSchema.parse(request.body);
    const template = await giftCardService.updateTermsTemplate(id, body);
    return reply.send({ data: template });
  });

  app.delete(`${prefix}/terms/:id`, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await giftCardService.deleteTermsTemplate(id);
    return reply.status(204).send();
  });

  done();
}

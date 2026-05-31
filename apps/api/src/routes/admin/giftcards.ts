import { normalizeCode } from "@loyaltyos/giftcards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { giftCardService } from "../../lib/giftcard-setup.js";
import { requireAdmin } from "../../plugins/require-admin.js";

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

// Refund/cancel body schemas (code in body — G.1)
const refundBodySchema = z.object({
  code: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

const cancelBodySchema = z.object({
  code: z.string().min(1),
});

const transactionsBodySchema = z.object({
  code: z.string().min(1),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  type: z.enum(["activate", "redeem", "refund", "cancel", "expire"]).optional(),
});

export function adminGiftCardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  const prefix = "/admin/giftcards";

  // ── Batches ──────────────────────────────────

  app.post(`${prefix}/batches`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = createBatchRouteSchema.parse(request.body);
    const batch = await giftCardService.createBatch({
      ...body,
      programId: request.programId,
      createdById: request.adminId ?? "system",
    });
    return reply.status(201).send({ data: batch });
  });

  app.get(`${prefix}/batches`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        status: z
          .enum(["pending", "generating", "ready", "partial", "failed", "cancelled"])
          .optional(),
      })
      .parse(request.query);

    const result = await giftCardService.listBatches(request.programId, query);
    return reply.send({ data: result });
  });

  app.get(`${prefix}/batches/:id`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const batch = await giftCardService.getBatch(id);
    return reply.send({ data: batch });
  });

  app.post(
    `${prefix}/batches/:id/cancel`,
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const batch = await giftCardService.cancelBatch(id);
      return reply.send({ data: batch });
    },
  );

  // I.1: CSV/XLSX export endpoint
  app.get(
    `${prefix}/batches/:id/export`,
    {
      preHandler: [requireAdmin],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { format } = z
        .object({ format: z.enum(["csv", "xlsx"]).default("csv") })
        .parse(request.query);

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

      const cards = await prisma.giftCard.findMany({
        where: { batchId: id },
        orderBy: { code: "asc" },
        select: {
          code: true,
          initialAmount: true,
          currency: true,
          expirationDate: true,
          status: true,
        },
      });

      if (format === "csv") {
        const { stringify } = await import("csv-stringify");
        const stringifier = stringify({
          header: true,
          columns: ["code", "initialAmount", "currency", "expirationDate", "status"],
        });

        void reply.header("Content-Type", "text/csv");
        void reply.header(
          "Content-Disposition",
          `attachment; filename="batch-${id}-${dateStr}.csv"`,
        );

        stringifier.on("data", (chunk: Buffer) => {
          reply.raw.write(chunk);
        });
        stringifier.on("end", () => {
          reply.raw.end();
        });

        for (const card of cards) {
          stringifier.write([
            card.code,
            String(card.initialAmount),
            card.currency,
            card.expirationDate.toISOString(),
            card.status,
          ]);
        }
        stringifier.end();

        return reply.hijack();
      }

      // XLSX
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: reply.raw,
        useStyles: false,
      });
      const worksheet = workbook.addWorksheet("Cards");

      worksheet.columns = [
        { header: "code", key: "code" },
        { header: "initialAmount", key: "initialAmount" },
        { header: "currency", key: "currency" },
        { header: "expirationDate", key: "expirationDate" },
        { header: "status", key: "status" },
      ];

      void reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      void reply.header(
        "Content-Disposition",
        `attachment; filename="batch-${id}-${dateStr}.xlsx"`,
      );

      for (const card of cards) {
        worksheet
          .addRow({
            code: card.code,
            initialAmount: Number(card.initialAmount),
            currency: card.currency,
            expirationDate: card.expirationDate.toISOString(),
            status: card.status,
          })
          .commit();
      }

      worksheet.commit();
      await workbook.commit();

      return reply.hijack();
    },
  );

  // ── Refund (moved from public routes — A.1) ──

  app.post(`${prefix}/refund`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = refundBodySchema.parse(request.body);

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return reply.status(400).send({
        error: { code: "MISSING_IDEMPOTENCY_KEY", message: "Idempotency-Key header is required" },
      });
    }

    const { getRedisConnection } = await import("../../lib/queue.js");
    const { createRedisLocks } = await import("@loyaltyos/giftcards");
    const redis = getRedisConnection();
    if (!redis) {
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Redis not available" },
      });
    }

    const result = await giftCardService.refund(
      {
        code: body.code,
        amount: body.amount,
        idempotencyKey,
        reason: body.reason,
        createdById: request.adminId ?? undefined,
        requestProgramId: request.programId,
      },
      createRedisLocks(redis),
    );
    return reply.send({ data: result });
  });

  // ── Cancel card (moved from public routes — A.1) ──

  app.post(`${prefix}/cancel`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = cancelBodySchema.parse(request.body);

    const { getRedisConnection } = await import("../../lib/queue.js");
    const { createRedisLocks } = await import("@loyaltyos/giftcards");
    const redis = getRedisConnection();
    if (!redis) {
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Redis not available" },
      });
    }

    const card = await giftCardService.cancelCard(
      {
        code: body.code,
        createdById: request.adminId ?? undefined,
        requestProgramId: request.programId,
      },
      createRedisLocks(redis),
    );
    return reply.send({ data: card });
  });

  // ── Transactions (moved from public routes — A.1) ──

  app.post(`${prefix}/transactions`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = transactionsBodySchema.parse(request.body);
    const normalized = normalizeCode(body.code);

    const card = await prisma.giftCard.findUnique({ where: { code: normalized } });
    if (!card) {
      return reply.status(404).send({
        error: { code: "GIFT_CARD_NOT_FOUND", message: "Gift card not found" },
      });
    }

    const result = await giftCardService.getTransactions(card.id, {
      page: body.page,
      pageSize: body.pageSize,
      type: body.type,
    });
    return reply.send({ data: result });
  });

  // ── Terms templates ──────────────────────────

  app.post(`${prefix}/terms`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = createTermsRouteSchema.parse(request.body);
    const template = await giftCardService.createTermsTemplate({
      ...body,
      programId: request.programId,
    });
    return reply.status(201).send({ data: template });
  });

  app.get(`${prefix}/terms`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const templates = await giftCardService.listTermsTemplates(request.programId);
    return reply.send({ data: templates });
  });

  app.get(`${prefix}/terms/:id`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const template = await giftCardService.getTermsTemplate(id);
    return reply.send({ data: template });
  });

  app.patch(`${prefix}/terms/:id`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateTermsSchema.parse(request.body);
    const template = await giftCardService.updateTermsTemplate(id, body);
    return reply.send({ data: template });
  });

  app.delete(`${prefix}/terms/:id`, { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await giftCardService.deleteTermsTemplate(id);
    return reply.status(204).send();
  });

  done();
}

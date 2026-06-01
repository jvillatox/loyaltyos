import { GiftCardBatchNotFoundError, normalizeCode } from "@loyaltyos/giftcards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
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

      // R1: Cross-tenant guard — verify batch ownership before exporting
      const batch = await prisma.giftCardBatch.findUnique({
        where: { id },
        include: { termsTemplate: { select: { version: true } } },
      });
      if (!batch || batch.programId !== request.programId) {
        throw new GiftCardBatchNotFoundError(id);
      }
      const termsVersion = String(batch.termsTemplate.version);

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const columns = [
        "code",
        "initialAmount",
        "currency",
        "expirationDate",
        "termsTemplateVersion",
        "status",
      ];

      // R5: Cursor pagination — stream 5k rows at a time, never load 1M into memory
      const PAGE_SIZE = 5000;
      let cardCount = 0;

      const writeRow = (
        writer: { write: (row: string[]) => void },
        card: {
          code: string;
          initialAmount: unknown;
          currency: string;
          expirationDate: Date;
          status: string;
        },
      ) => {
        writer.write([
          card.code,
          String(card.initialAmount),
          card.currency,
          card.expirationDate.toISOString(),
          termsVersion,
          card.status,
        ]);
      };

      const xlsxRow = (card: {
        code: string;
        initialAmount: unknown;
        currency: string;
        expirationDate: Date;
        status: string;
      }) => ({
        code: card.code,
        initialAmount: Number(card.initialAmount),
        currency: card.currency,
        expirationDate: card.expirationDate.toISOString(),
        termsTemplateVersion: termsVersion,
        status: card.status,
      });

      if (format === "csv") {
        const { stringify } = await import("csv-stringify");
        const stringifier = stringify({ header: true, columns });

        void reply.header("Content-Type", "text/csv");
        void reply.header(
          "Content-Disposition",
          `attachment; filename="batch-${id}-${dateStr}.csv"`,
        );

        stringifier.on("data", (chunk: Buffer) => {
          void reply.raw.write(chunk);
        });
        stringifier.on("end", () => {
          reply.raw.end();
        });

        let cursor: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const page = await prisma.giftCard.findMany({
            where: { batchId: id },
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: "asc" },
            select: {
              id: true,
              code: true,
              initialAmount: true,
              currency: true,
              expirationDate: true,
              status: true,
            },
          });
          if (page.length === 0) {
            hasMore = false;
            continue;
          }
          for (const card of page) {
            writeRow(stringifier, card);
            cardCount++;
          }
          if (page.length < PAGE_SIZE) {
            hasMore = false;
            continue;
          }
          const last = page.at(-1);
          if (last) {
            cursor = last.id;
          } else {
            hasMore = false;
          }
        }
        stringifier.end();

        await audit(request.programId, request.actor, "OTHER", "gift_card_batch", id, {
          action: "giftcard.batch.export",
          format: "csv",
          cardCount,
        });

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
        { header: "termsTemplateVersion", key: "termsTemplateVersion" },
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

      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await prisma.giftCard.findMany({
          where: { batchId: id },
          take: PAGE_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: "asc" },
          select: {
            id: true,
            code: true,
            initialAmount: true,
            currency: true,
            expirationDate: true,
            status: true,
          },
        });
        if (page.length === 0) {
          hasMore = false;
          continue;
        }
        for (const card of page) {
          worksheet.addRow(xlsxRow(card)).commit();
          cardCount++;
        }
        if (page.length < PAGE_SIZE) {
          hasMore = false;
          continue;
        }
        const last = page.at(-1);
        if (last) {
          cursor = last.id;
        } else {
          hasMore = false;
        }
      }

      worksheet.commit();
      await workbook.commit();

      await audit(request.programId, request.actor, "OTHER", "gift_card_batch", id, {
        action: "giftcard.batch.export",
        format: "xlsx",
        cardCount,
      });

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

    // R2: Tenant-scoped lookup — reject codes from other programs
    const card = await prisma.giftCard.findFirst({
      where: { code: normalized, batch: { programId: request.programId } },
    });
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

import { addMonths } from "@loyaltyos/core";
import { isSupportedLocale } from "@loyaltyos/i18n";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";

const updateProgramSchema = z.object({
  defaultLocale: z.string().refine(isSupportedLocale, "Unsupported locale").optional(),
  supportedLocales: z.array(z.string().refine(isSupportedLocale, "Unsupported locale")).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  pointsUnit: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
  adjustOperatorPerTxLimit: z.number().int().min(1).optional(),
  adjustOperatorDailyLimit: z.number().int().min(1).optional(),
  adjustServerPerTxLimit: z.number().int().min(1).optional(),
  holdDays: z.number().int().min(0).max(90).optional(),
  expiryMode: z.enum(["NONE", "INACTIVITY", "PER_LOT"]).optional(),
  expiryMonths: z.number().int().min(1).max(60).optional(),
});

const programSelect = {
  id: true,
  name: true,
  description: true,
  pointsUnit: true,
  logoUrl: true,
  isActive: true,
  defaultLocale: true,
  supportedLocales: true,
  adjustOperatorPerTxLimit: true,
  adjustOperatorDailyLimit: true,
  adjustServerPerTxLimit: true,
  holdDays: true,
  expiryMode: true,
  expiryMonths: true,
  expiryChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function adminProgramsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** GET /admin/programs/:id — get program details including locale settings */
  app.get("/admin/programs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    if (id !== request.programId) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Program not found" },
      });
    }

    const program = await prisma.program.findUnique({
      where: { id },
      select: programSelect,
    });

    if (!program) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Program not found" },
      });
    }

    return reply.send({ data: program });
  });

  /** PATCH /admin/programs/:id — update program settings including locale */
  app.patch("/admin/programs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateProgramSchema.parse(request.body);

    if (id !== request.programId) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Program not found" },
      });
    }

    const { program, expiryChanging } = await prisma.$transaction(async (tx) => {
      const current = await tx.program.findUniqueOrThrow({ where: { id } });

      const expiryModeChanged =
        body.expiryMode !== undefined && body.expiryMode !== current.expiryMode;
      const expiryMonthsChanged =
        body.expiryMonths !== undefined && body.expiryMonths !== current.expiryMonths;
      const changing = expiryModeChanged || expiryMonthsChanged;

      if (!changing) {
        const updated = await tx.program.update({
          where: { id },
          data: body,
          select: programSelect,
        });
        return { program: updated, expiryChanging: false };
      }

      const newMode = body.expiryMode ?? current.expiryMode;
      const now = new Date();

      const updated = await tx.program.update({
        where: { id },
        data: { ...body, expiryChangedAt: now },
        select: programSelect,
      });

      // Existing spendable lots follow the new rule: entering PER_LOT backfills
      // an expiry from now; leaving PER_LOT clears it so nothing is lost.
      if (current.expiryMode !== "PER_LOT" && newMode === "PER_LOT") {
        await tx.pointLot.updateMany({
          where: { programId: id, remaining: { gt: 0 }, expiresAt: null },
          data: { expiresAt: addMonths(now, updated.expiryMonths) },
        });
      } else if (current.expiryMode === "PER_LOT" && newMode !== "PER_LOT") {
        await tx.pointLot.updateMany({
          where: { programId: id, remaining: { gt: 0 } },
          data: { expiresAt: null },
        });
      }

      return { program: updated, expiryChanging: true };
    });

    if (expiryChanging) {
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "program", id, {
        expiryMode: body.expiryMode,
        expiryMonths: body.expiryMonths,
      });
    }

    return reply.send({ data: program });
  });

  done();
}

import { isSupportedLocale } from "@loyaltyos/i18n";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";

const updateProgramSchema = z.object({
  defaultLocale: z.string().refine(isSupportedLocale, "Unsupported locale").optional(),
  supportedLocales: z.array(z.string().refine(isSupportedLocale, "Unsupported locale")).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  pointsUnit: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
});

export function adminProgramsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** GET /admin/programs/:id — get program details including locale settings */
  app.get("/admin/programs/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const program = await prisma.program.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        pointsUnit: true,
        logoUrl: true,
        isActive: true,
        defaultLocale: true,
        supportedLocales: true,
        createdAt: true,
        updatedAt: true,
      },
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

    const program = await prisma.program.update({
      where: { id },
      data: body,
      select: {
        id: true,
        name: true,
        description: true,
        pointsUnit: true,
        logoUrl: true,
        isActive: true,
        defaultLocale: true,
        supportedLocales: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.send({ data: program });
  });

  done();
}

import { BadgesService } from "@loyaltyos/badges";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";

const badges = new BadgesService(prisma);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["ACHIEVEMENT", "STATUS", "TEMPORAL", "COLLECTIBLE", "SOCIAL"]),
  imageUrl: z.string().optional(),
  tierId: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
  seriesId: z.string().optional(),
  seriesPosition: z.number().int().min(1).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(["ACHIEVEMENT", "STATUS", "TEMPORAL", "COLLECTIBLE", "SOCIAL"]).optional(),
  imageUrl: z.string().optional(),
  tierId: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
  seriesId: z.string().optional(),
  seriesPosition: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
});

export function adminBadgesRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/badges — Create badge
  app.post("/admin/badges", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const badge = await badges.create({
      ...body,
      programId,
    });
    return reply.status(201).send({ data: badge });
  });

  // GET /admin/badges — List badges
  app.get("/admin/badges", async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        type: z.string().optional(),
        isActive: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => {
            if (v === "true") return true;
            if (v === "false") return false;
            return undefined;
          }),
        search: z.string().optional(),
      })
      .parse(request.query);

    const programId = request.programId || (request.headers["x-program-id"] as string);
    const result = await badges.list(programId, query);
    return reply.send({ data: result });
  });

  // GET /admin/badges/stats — Badge distribution stats
  app.get("/admin/badges/stats", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const stats = await badges.stats(programId);
    return reply.send({ data: stats });
  });

  // GET /admin/badges/:id — Get badge by id
  app.get("/admin/badges/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const badge = await badges.getById(id);
    return reply.send({ data: badge });
  });

  // PATCH /admin/badges/:id — Update badge
  app.patch("/admin/badges/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const badge = await badges.update(id, body);
    return reply.send({ data: badge });
  });

  // DELETE /admin/badges/:id — Soft delete badge
  app.delete("/admin/badges/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await badges.delete(id);
    return reply.status(204).send();
  });

  done();
}

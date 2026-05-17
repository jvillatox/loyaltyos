import { TiersService } from "@loyaltyos/badges";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";

const tiers = new TiersService(prisma);

const createSchema = z.object({
  name: z.string().min(1),
  rank: z.number().int().min(1),
  minPoints: z.number().int().min(0),
  color: z.string().optional(),
  iconUrl: z.string().optional(),
  benefits: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  rank: z.number().int().min(1).optional(),
  minPoints: z.number().int().min(0).optional(),
  color: z.string().optional(),
  iconUrl: z.string().optional(),
  benefits: z.record(z.unknown()).optional(),
});

const reorderSchema = z.object({
  tierIds: z.array(z.string().min(1)).min(1),
});

export function adminTiersRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/tiers — Create tier
  app.post("/admin/tiers", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const tier = await tiers.create({ ...body, programId });
    return reply.status(201).send({ data: tier });
  });

  // GET /admin/tiers — List tiers (ordered by rank)
  app.get("/admin/tiers", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const result = await tiers.list(programId);
    return reply.send({ data: result });
  });

  // GET /admin/tiers/stats — Tier distribution stats (pyramid)
  app.get("/admin/tiers/stats", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const stats = await tiers.stats(programId);
    return reply.send({ data: stats });
  });

  // GET /admin/tiers/:id — Get tier by id
  app.get("/admin/tiers/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const tier = await tiers.getById(id);
    return reply.send({ data: tier });
  });

  // GET /admin/tiers/:id/benefits — Get tier benefits
  app.get("/admin/tiers/:id/benefits", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const benefits = await tiers.benefits(id);
    return reply.send({ data: benefits });
  });

  // PATCH /admin/tiers/:id — Update tier
  app.patch("/admin/tiers/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const tier = await tiers.update(id, body);
    return reply.send({ data: tier });
  });

  // DELETE /admin/tiers/:id — Delete tier
  app.delete("/admin/tiers/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await tiers.delete(id);
    return reply.status(204).send();
  });

  // PATCH /admin/tiers/reorder — Reorder tier ranks
  app.patch("/admin/tiers/reorder", async (request, reply) => {
    const body = reorderSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    await tiers.reorder(programId, body.tierIds);
    const result = await tiers.list(programId);
    return reply.send({ data: result });
  });

  done();
}

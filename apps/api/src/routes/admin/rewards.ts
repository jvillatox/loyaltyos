import {
  restockSchema,
  rewardCreateSchema,
  RewardsService,
  rewardUpdateSchema,
} from "@loyaltyos/rewards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";

const rewards = new RewardsService(prisma);

export function adminRewardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/rewards — create a reward
  app.post("/admin/rewards", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const body = rewardCreateSchema.parse({ ...(request.body as object), programId });
    const reward = await rewards.create(body);
    return reply.status(201).send({ data: reward });
  });

  // GET /admin/rewards — list all rewards for a program
  app.get("/admin/rewards", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const query = z
      .object({
        category: z.string().optional(),
        isActive: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => {
            if (v === "true") return true;
            if (v === "false") return false;
            return undefined;
          }),
        minPoints: z.coerce.number().int().min(0).optional(),
        maxPoints: z.coerce.number().int().min(0).optional(),
        tierRequired: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const result = await rewards.list(programId, query);
    return reply.send({ data: result });
  });

  // GET /admin/rewards/:id — get a single reward
  app.get("/admin/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const reward = await rewards.getById(id);
    return reply.send({ data: reward });
  });

  // PATCH /admin/rewards/:id — update a reward
  app.patch("/admin/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = rewardUpdateSchema.parse(request.body);
    const reward = await rewards.update(id, body);
    return reply.send({ data: reward });
  });

  // DELETE /admin/rewards/:id — soft delete a reward
  app.delete("/admin/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await rewards.softDelete(id);
    return reply.status(204).send();
  });

  // POST /admin/rewards/:id/archive — archive a reward
  app.post("/admin/rewards/:id/archive", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await rewards.archive(id);
    return reply.status(204).send();
  });

  // POST /admin/rewards/:id/publish — publish a reward
  app.post("/admin/rewards/:id/publish", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const reward = await rewards.publish(id);
    return reply.send({ data: reward });
  });

  // POST /admin/rewards/:id/restock — add stock to a reward
  app.post("/admin/rewards/:id/restock", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { qty } = restockSchema.parse(request.body);
    const reward = await rewards.restock(id, qty);
    return reply.send({ data: reward });
  });

  done();
}

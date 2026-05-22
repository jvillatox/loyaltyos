import { redeemSchema, rewardListQuerySchema, RewardsService } from "@loyaltyos/rewards";
import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

const rewards = new RewardsService(prisma);

export function rewardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // GET /rewards — public catalog with filters
  app.get("/rewards", async (request, reply) => {
    const query = rewardListQuerySchema.parse(request.query);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const result = await rewards.list(programId, query);
    return reply.send({ data: result });
  });

  // GET /rewards/:id — detail with optional ?memberId= for eligibility
  app.get("/rewards/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const memberId = (request.query as { memberId?: string }).memberId;
    const result = await rewards.detail(id, memberId);
    return reply.send({ data: result });
  });

  // POST /rewards/:id/redeem — redeem a reward (rate-limited)
  app.post(
    "/rewards/:id/redeem",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = redeemSchema.parse(request.body);
      const result = await rewards.redeem(body.rewardId || id, body.memberId, body.idempotencyKey);
      return reply.status(201).send({ data: result });
    },
  );

  done();
}

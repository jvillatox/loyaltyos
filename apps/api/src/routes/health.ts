import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";

export function healthRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/healthz", async (_req, reply) => {
    return reply.send({ status: "ok", uptime: process.uptime() });
  });

  app.get("/readyz", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.status(503).send({ status: "not ready", db: false, redis: false });
    }
    return reply.send({ status: "ready", db: true, redis: true });
  });

  done();
}

import type { FastifyInstance } from "fastify";

import { prisma } from "../db.js";
import { getRedisConnection } from "../lib/queue.js";

export function healthRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/healthz", async (_req, reply) => {
    return reply.send({ status: "ok", uptime: process.uptime() });
  });

  app.get("/readyz", async (_req, reply) => {
    let dbOk = false;
    let redisOk = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      // DB unreachable
    }

    try {
      const redis = getRedisConnection();
      if (redis) {
        await redis.ping();
        redisOk = true;
      }
    } catch {
      // Redis unreachable
    }

    if (!dbOk || !redisOk) {
      return reply.status(503).send({ status: "not ready", db: dbOk, redis: redisOk });
    }

    return reply.send({ status: "ready", db: true, redis: true });
  });

  done();
}

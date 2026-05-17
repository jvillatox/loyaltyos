import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { prisma } from "./db.js";
import { errorHandler } from "./lib/error-handler.js";
import { authPlugin } from "./plugins/auth.js";
import { adminBadgesRoutes } from "./routes/admin/badges.js";
import { adminCampaignsRoutes } from "./routes/admin/campaigns.js";
import { adminCouponsRoutes } from "./routes/admin/coupons.js";
import { adminNotificationsRoutes } from "./routes/admin/notifications.js";
import { adminSegmentsRoutes } from "./routes/admin/segments.js";
import { adminTiersRoutes } from "./routes/admin/tiers.js";
import { couponsRoutes } from "./routes/coupons.js";
import { eventsRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { membersRoutes } from "./routes/members.js";
import { statsRoutes } from "./routes/stats.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? process.env.LOG_LEVEL !== "silent",
    genReqId: () => crypto.randomUUID(),
  });

  // Plugins
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 1000,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      return (req.headers["x-api-key"] as string | undefined) ?? req.ip;
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "LoyaltyOS API",
        version: "0.1.0",
        description: "Open source customer loyalty platform — REST API",
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: "apiKey",
            name: "X-API-Key",
            in: "header",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  // Custom plugins
  await app.register(authPlugin);

  // Error handling
  app.setErrorHandler(errorHandler);

  // Routes
  await app.register(healthRoutes, { prefix: "/" });
  await app.register(membersRoutes, { prefix: "/api/v1" });
  await app.register(eventsRoutes, { prefix: "/api/v1" });
  await app.register(adminCampaignsRoutes, { prefix: "/api/v1" });
  await app.register(statsRoutes, { prefix: "/api/v1" });
  await app.register(adminSegmentsRoutes, { prefix: "/api/v1" });
  await app.register(adminBadgesRoutes, { prefix: "/api/v1" });
  await app.register(adminTiersRoutes, { prefix: "/api/v1" });
  await app.register(adminCouponsRoutes, { prefix: "/api/v1" });
  await app.register(adminNotificationsRoutes, { prefix: "/api/v1" });
  await app.register(couponsRoutes, { prefix: "/api/v1" });

  return app;
}

export { prisma };

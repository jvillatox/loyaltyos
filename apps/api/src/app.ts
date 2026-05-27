import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  createBullMQMetrics,
  createFastifyMetricsPlugin,
  createHttpMetrics,
  createMetricsRegistry,
  Registry,
  setupDefaultMetrics,
} from "@loyaltyos/telemetry";
import Fastify from "fastify";

import { prisma } from "./db.js";
import { getBusinessMetricsRegistry } from "./lib/business-metrics.js";
import { errorHandler } from "./lib/error-handler.js";
import { authPlugin } from "./plugins/auth.js";
import { adminAiRoutes } from "./routes/admin/ai.js";
import { adminAuthRoutes } from "./routes/admin/auth.js";
import { adminBadgesRoutes } from "./routes/admin/badges.js";
import { adminCampaignsRoutes } from "./routes/admin/campaigns.js";
import { adminCoalitionRoutes } from "./routes/admin/coalition.js";
import { adminCouponsRoutes } from "./routes/admin/coupons.js";
import { adminNotificationsRoutes } from "./routes/admin/notifications.js";
import { adminProgramsRoutes } from "./routes/admin/programs.js";
import { adminRewardsRoutes } from "./routes/admin/rewards.js";
import { adminSegmentsRoutes } from "./routes/admin/segments.js";
import { adminTiersRoutes } from "./routes/admin/tiers.js";
import { authRoutes } from "./routes/auth.js";
import { coalitionRoutes } from "./routes/coalition.js";
import { couponsRoutes } from "./routes/coupons.js";
import { eventsRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { membersRoutes } from "./routes/members.js";
import { rewardsRoutes } from "./routes/rewards.js";
import { statsRoutes } from "./routes/stats.js";

interface BullMQMetricsExport {
  bullmqQueueDepth: { set: (labels: Record<string, string>, val: number) => void };
  bullmqJobDuration: { observe: (labels: Record<string, string>, val: number) => void };
  bullmqJobCounter: { inc: (labels: Record<string, string>) => void };
}

let metricsExports: BullMQMetricsExport | null = null;

export function getBullMQMetrics(): BullMQMetricsExport | null {
  return metricsExports;
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? process.env.LOG_LEVEL !== "silent",
    genReqId: () => crypto.randomUUID(),
  });

  // Metrics (before plugins to capture all traffic)
  const metricsRegistry = createMetricsRegistry();
  setupDefaultMetrics(metricsRegistry, "loyaltyos-api");
  const httpMetrics = createHttpMetrics(metricsRegistry);
  const bullmqMetrics = createBullMQMetrics(metricsRegistry);
  metricsExports = bullmqMetrics;

  // Merge HTTP + business registries for the /metrics endpoint
  const mergedRegistry = Registry.merge([metricsRegistry, getBusinessMetricsRegistry()]);

  // Security headers (helmet)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });

  // CORS — whitelist from env var, default to restrictive
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
    : process.env.CORS_ORIGIN
      ? [process.env.CORS_ORIGIN]
      : null;

  await app.register(cors, {
    origin: corsOrigins ?? (process.env.NODE_ENV === "production" ? false : true),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Program-Id",
      "Idempotency-Key",
    ],
    maxAge: 86400,
  });

  // Rate limiting — global default
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

  // Error handling (must be set before routes to apply globally)
  app.setErrorHandler(errorHandler);

  // Telemetry — exposes /metrics and records HTTP stats
  await app.register(createFastifyMetricsPlugin, {
    registry: { registry: mergedRegistry, ...httpMetrics, ...bullmqMetrics },
  });

  // Public routes (before auth plugin)
  await app.register(authRoutes, { prefix: "/api/v1" });
  await app.register(adminAuthRoutes, { prefix: "/api/v1" });

  // Custom plugins
  await app.register(authPlugin);

  // Protected routes (after auth plugin)
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
  await app.register(rewardsRoutes, { prefix: "/api/v1" });
  await app.register(adminRewardsRoutes, { prefix: "/api/v1" });
  await app.register(adminAiRoutes, { prefix: "/api/v1" });
  await app.register(coalitionRoutes, { prefix: "/api/v1" });
  await app.register(adminCoalitionRoutes, { prefix: "/api/v1" });
  await app.register(adminProgramsRoutes, { prefix: "/api/v1" });

  return app;
}

export { prisma };

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";

import { prisma } from "./db.js";
import { errorHandler } from "./lib/error-handler.js";
import { authPlugin } from "./plugins/auth.js";
import { eventsRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { membersRoutes } from "./routes/members.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
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

// Start
const port = Number(process.env.PORT_API) || 3000;
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Server running on http://${host}:${String(port)}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, prisma };

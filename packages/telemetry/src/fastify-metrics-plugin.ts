import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import type { MetricsRegistry } from "./metrics.js";

const METRICS_ROUTE = "/metrics";
const EXCLUDED_PATHS = ["/metrics", "/healthz"];

interface FastifyMetricsPluginOptions {
  registry: MetricsRegistry;
}

export const createFastifyMetricsPlugin = fp<FastifyMetricsPluginOptions>(
  (app: FastifyInstance, opts: FastifyMetricsPluginOptions) => {
    const { registry } = opts;

    app.get(METRICS_ROUTE, async (_req: FastifyRequest, reply: FastifyReply) => {
      const { getMetricsPayload, getMetricsContentType } = await import("./metrics.js");
      const payload = await getMetricsPayload(registry.registry);
      return reply.header("Content-Type", getMetricsContentType()).send(payload);
    });

    app.addHook("onResponse", (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
      if (EXCLUDED_PATHS.includes(req.routeOptions.url ?? "")) {
        done();
        return;
      }

      const method = req.method;
      const route = req.routeOptions.url ?? "unknown";
      const statusCode = String(reply.statusCode);
      const duration = reply.elapsedTime / 1000;

      registry.httpRequestCounter.inc({ method, route, status_code: statusCode });
      registry.httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);

      if (reply.statusCode >= 500) {
        registry.httpErrorCounter.inc({ method, route });
      }

      done();
    });
  },
  {
    name: "fastify-metrics",
    fastify: "^4.0.0",
  },
);

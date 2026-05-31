import { createServer } from "node:http";

import {
  createMetricsRegistry,
  getMetricsContentType,
  getMetricsPayload,
  initTracing,
  setupDefaultMetrics,
} from "@loyaltyos/telemetry";

// Must be first — initializes OpenTelemetry before any module creates connections
await initTracing("loyaltyos-worker");

import { closeQueueConnection } from "./lib/queue.js";
import { startGiftCardExpireWorker, startGiftCardGenerateWorker } from "./workers/giftcards.js";
import { startNotificationsWorker } from "./workers/notifications.js";

// Metrics
const metricsRegistry = createMetricsRegistry();
setupDefaultMetrics(metricsRegistry, "loyaltyos-worker");

// Start workers
startNotificationsWorker();
startGiftCardGenerateWorker();
startGiftCardExpireWorker();

// Minimal HTTP server for health check and metrics (Prometheus scrape target)
const metricsPort = Number(process.env.WORKER_METRICS_PORT) || 3003;

const server = createServer((_req, res) => {
  void (async () => {
    const url = _req.url ?? "/";

    if (url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    if (url === "/metrics") {
      const payload = await getMetricsPayload(metricsRegistry);
      res.writeHead(200, { "Content-Type": getMetricsContentType() });
      res.end(payload);
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  })();
});

server.listen(metricsPort, () => {
  console.log(`[Worker] Metrics server listening on port ${String(metricsPort)}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("[Worker] Shutting down...");
  await closeQueueConnection();
  server.close();
  process.exit(0);
};

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

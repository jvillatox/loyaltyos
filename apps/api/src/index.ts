import { initTracing } from "@loyaltyos/telemetry";

// Must be first — initializes OpenTelemetry before any module creates connections
await initTracing("loyaltyos-api");

import { buildApp, getBullMQMetrics, prisma } from "./app.js";
import { createQueue } from "./lib/queue.js";
import { startNotificationsWorker } from "./workers/notifications.js";

const app = await buildApp();

// Start
const port = Number(process.env.PORT_API) || 3000;
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Server running on http://${host}:${String(port)}`);

  // Start workers after HTTP server is listening
  startNotificationsWorker();

  // Collect BullMQ queue depth metrics periodically
  const bullmqMetrics = getBullMQMetrics();
  if (bullmqMetrics) {
    const queueGauge = bullmqMetrics.bullmqQueueDepth;
    const queueNames = ["notifications"];
    const queues = queueNames.map((name) => createQueue(name));

    const collectQueueMetrics = async () => {
      for (let i = 0; i < queueNames.length; i++) {
        const name = queueNames[i];
        const queue = queues[i];
        if (!name || !queue) continue;
        try {
          const counts = await queue.getJobCounts();
          queueGauge.set({ queue: `${name}_waiting` }, counts.waiting ?? 0);
          queueGauge.set({ queue: `${name}_active` }, counts.active ?? 0);
          queueGauge.set({ queue: `${name}_delayed` }, counts.delayed ?? 0);
          queueGauge.set({ queue: `${name}_completed` }, counts.completed ?? 0);
          queueGauge.set({ queue: `${name}_failed` }, counts.failed ?? 0);
        } catch {
          // Queue not connected yet — skip
        }
      }
    };

    setInterval(() => {
      void collectQueueMetrics();
    }, 15_000);
    void collectQueueMetrics();
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, prisma };

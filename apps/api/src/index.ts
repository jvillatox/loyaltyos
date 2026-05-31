import { initTracing } from "@loyaltyos/telemetry";

// Must be first — initializes OpenTelemetry before any module creates connections
await initTracing("loyaltyos-api");

import { buildApp, getBullMQMetrics, prisma } from "./app.js";
import { getBusinessMetrics } from "./lib/business-metrics.js";
import {
  scheduleGiftCardExpiration,
  scheduleOutstandingBalanceRefresh,
} from "./lib/giftcard-setup.js";
import { createQueue } from "./lib/queue.js";
import {
  startGiftCardExpireWorker,
  startGiftCardGenerateWorker,
  startOutstandingBalanceWorker,
} from "./workers/giftcards.js";
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
  startGiftCardGenerateWorker();
  startGiftCardExpireWorker();
  startOutstandingBalanceWorker();
  await scheduleGiftCardExpiration();
  await scheduleOutstandingBalanceRefresh();

  // Collect BullMQ queue depth metrics periodically
  const bullmqMetrics = getBullMQMetrics();
  if (bullmqMetrics) {
    const queueGauge = bullmqMetrics.bullmqQueueDepth;
    const queueNames = [
      "notifications",
      "giftcards.batch.generate",
      "giftcards.expire",
      "giftcards.outstanding-balance.refresh",
    ];
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

    // Active members hourly gauge
    setInterval(
      () => {
        void (async () => {
          try {
            const programs = await prisma.program.findMany({ select: { id: true } });
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            for (const { id } of programs) {
              const count = await prisma.member.count({
                where: { programId: id, lastActiveAt: { gt: oneHourAgo } },
              });
              getBusinessMetrics().activeMembersTotal.set({ program_id: id }, count);
            }
          } catch (err) {
            app.log.error({ err }, "active members scheduler failed");
          }
        })();
      },
      60 * 60 * 1000,
    ); // hourly
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, prisma };

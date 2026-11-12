import { expirePendingAdjustments } from "../lib/point-adjustments.js";
import { createWorker } from "../lib/queue.js";

export function startPointAdjustmentExpiryWorker(): void {
  createWorker("point-adjustments.expire", async () => {
    const count = await expirePendingAdjustments();
    console.log(`[Worker] Point adjustment expiry: ${String(count)} requests expired`);
  });

  console.log("[Worker] Point adjustment expiry worker started");
}

import { coalitionService } from "../lib/coalition-setup.js";
import { createWorker } from "../lib/queue.js";

export function startCoalitionReconciliationWorker(): void {
  createWorker("coalition.reconciliation", async () => {
    const summary = await coalitionService.runReconciliationSweep();
    console.log(
      `[Worker] Coalition reconciliation: ${String(summary.scanned)} scanned, ` +
        `${String(summary.confirmed)} confirmed, ${String(summary.failed)} failed, ` +
        `${String(summary.needsReview)} needs-review, ${String(summary.stillPending)} still pending`,
    );
  });

  console.log("[Worker] Coalition reconciliation worker started");
}

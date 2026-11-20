import { createQueue } from "./queue.js";

// Every 15 minutes, reconcile PENDING coalition transactions older than 5 min.
const reconciliationQueue = createQueue("coalition.reconciliation");

export async function scheduleCoalitionReconciliation(): Promise<void> {
  await reconciliationQueue.add(
    "reconcile-pending",
    {},
    {
      repeat: { pattern: "*/15 * * * *" },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
}

export { reconciliationQueue };

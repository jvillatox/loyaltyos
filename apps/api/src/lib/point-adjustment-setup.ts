import { createQueue } from "./queue.js";

// Daily expiry of undecided point-adjustment requests (7-day window).
const expiryQueue = createQueue("point-adjustments.expire");

export async function schedulePointAdjustmentExpiry(): Promise<void> {
  await expiryQueue.add(
    "daily-expiry",
    {},
    {
      repeat: { pattern: "0 4 * * *" },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
}

export { expiryQueue };

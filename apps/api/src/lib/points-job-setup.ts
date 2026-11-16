import { createQueue } from "./queue.js";

// Hourly settlement of held points that have passed their program hold period.
const settlementQueue = createQueue("points.settle-pending");

// Daily expiry of earned points past their expiresAt.
const expiryQueue = createQueue("points.expire");

export async function schedulePointsSettlement(): Promise<void> {
  await settlementQueue.add(
    "hourly-settlement",
    {},
    {
      repeat: { pattern: "0 * * * *" },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
}

export async function schedulePointsExpiry(): Promise<void> {
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

export { expiryQueue, settlementQueue };

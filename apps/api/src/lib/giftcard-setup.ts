import { GiftCardService } from "@loyaltyos/giftcards";

import { prisma } from "../db.js";
import { adaptGiftCardMetrics, getBusinessMetrics } from "./business-metrics.js";
import { createQueue } from "./queue.js";

// Boot-time guard: require non-default secret in production (C.1)
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.GIFTCARD_HMAC_SECRET || process.env.GIFTCARD_HMAC_SECRET === "dev-secret")
) {
  console.error("FATAL: GIFTCARD_HMAC_SECRET must be set to a non-default value in production");
  process.exit(1);
}

export const giftCardService = new GiftCardService(prisma, {
  codeSecret: process.env.GIFTCARD_HMAC_SECRET,
  metrics: adaptGiftCardMetrics(getBusinessMetrics()),
});

// Wire BullMQ enqueue for batch generation
const generateQueue = createQueue("giftcards.batch.generate");

giftCardService.setEnqueueGenerate(async (_jobName: string, data: Record<string, unknown>) => {
  await generateQueue.add("generate", data);
});

// Daily expiration cron — repeatable job
const expireQueue = createQueue("giftcards.expire");

export async function scheduleGiftCardExpiration(): Promise<void> {
  await expireQueue.add(
    "daily-expire",
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
}

// Hourly outstanding-balance refresh (I.3)
const balanceQueue = createQueue("giftcards.outstanding-balance.refresh");

export async function scheduleOutstandingBalanceRefresh(): Promise<void> {
  await balanceQueue.add(
    "hourly-refresh",
    {},
    {
      repeat: { pattern: "0 * * * *" },
      removeOnComplete: true,
      removeOnFail: 5,
    },
  );
}

export { balanceQueue, expireQueue, generateQueue };

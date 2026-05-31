import { GiftCardService } from "@loyaltyos/giftcards";

import { prisma } from "../db.js";
import { adaptGiftCardMetrics, getBusinessMetrics } from "./business-metrics.js";
import { createQueue } from "./queue.js";

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

export { expireQueue, generateQueue };

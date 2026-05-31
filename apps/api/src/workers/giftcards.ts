import { giftCardService } from "../lib/giftcard-setup.js";
import { createWorker } from "../lib/queue.js";

export function startGiftCardGenerateWorker(): void {
  createWorker("giftcards.batch.generate", async (job) => {
    const { batchId } = job.data as { batchId: string };
    await giftCardService.generateBatchCodes(batchId);
  });

  console.log("[Worker] GiftCard generate worker started");
}

export function startGiftCardExpireWorker(): void {
  createWorker("giftcards.expire", async () => {
    const count = await giftCardService.processExpiredCards();
    console.log(`[Worker] GiftCard expire: ${String(count)} cards expired`);
  });

  console.log("[Worker] GiftCard expire worker started");
}

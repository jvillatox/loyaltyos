import { prisma } from "../db.js";
import { getBusinessMetrics } from "../lib/business-metrics.js";
import { giftCardService } from "../lib/giftcard-setup.js";
import { createWorker } from "../lib/queue.js";

export function startGiftCardGenerateWorker(): void {
  createWorker("giftcards.batch.generate", async (job) => {
    const { batchId } = job.data as { batchId: string };
    await giftCardService.generateBatchCodes(batchId);
    // generateBatchCodes now re-throws after marking failed (J.2),
    // so BullMQ correctly classifies the job as failed.
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

export function startOutstandingBalanceWorker(): void {
  const bm = getBusinessMetrics();

  createWorker("giftcards.outstanding-balance.refresh", async () => {
    const programs = await prisma.program.findMany({ select: { id: true } });
    for (const program of programs) {
      const rows = await giftCardService.getOutstandingBalances(program.id);
      for (const row of rows) {
        bm.giftCardsOutstandingBalance.set(
          { program_id: row.programId, currency: row.currency },
          row.total,
        );
      }
    }
    console.log(`[Worker] Outstanding balance refreshed for ${String(programs.length)} programs`);
  });

  console.log("[Worker] GiftCard outstanding-balance worker started");
}

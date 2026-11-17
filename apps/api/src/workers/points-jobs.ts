import { PointsService } from "@loyaltyos/core";

import { prisma } from "../db.js";
import { sendExpiryReminders } from "../lib/points-reminder.js";
import { createWorker } from "../lib/queue.js";

const points = new PointsService(prisma);

export function startPointsSettlementWorker(): void {
  createWorker("points.settle-pending", async () => {
    const programs = await prisma.program.findMany({
      where: { holdDays: { gt: 0 } },
      select: { id: true },
    });
    let settled = 0;
    for (const { id } of programs) {
      settled += await points.settlePending(id);
    }
    console.log(`[Worker] Points settlement: ${String(settled)} transactions settled`);
  });

  console.log("[Worker] Points settlement worker started");
}

export function startPointsExpiryWorker(): void {
  createWorker("points.expire", async () => {
    const programs = await prisma.program.findMany({ select: { id: true } });
    let expired = 0;
    let reminded = 0;
    for (const { id } of programs) {
      expired += await points.expire(id);
      reminded += await sendExpiryReminders(id);
    }
    console.log(
      `[Worker] Points expiry: ${String(expired)} lots/accounts expired, ${String(reminded)} reminders sent`,
    );
  });

  console.log("[Worker] Points expiry worker started");
}

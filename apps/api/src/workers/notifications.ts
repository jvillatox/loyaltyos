import { notificationsService } from "../lib/notifications-setup.js";
import { createWorker } from "../lib/queue.js";

export function startNotificationsWorker(): void {
  createWorker("notifications", async (job) => {
    const { notificationId } = job.data as { notificationId: string };
    await notificationsService.deliver(notificationId);
  });

  console.log("[Worker] Notifications worker started");
}

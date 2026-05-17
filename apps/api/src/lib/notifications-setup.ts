import {
  createSmtpProvider,
  NotificationsService,
  SmtpProvider,
  WebhookProvider,
} from "@loyaltyos/notifications";

import { prisma } from "../db.js";
import { createQueue } from "./queue.js";

/** Shared notifications service, configured with SMTP provider and BullMQ enqueue. */
export const notificationsService = new NotificationsService(prisma);

// Register SMTP provider
notificationsService.setProvider("EMAIL", createSmtpProvider());

// Wire BullMQ enqueue
const notificationsQueue = createQueue("notifications");

notificationsService.setEnqueue(async (notificationId: string) => {
  await notificationsQueue.add("send", { notificationId });
});

export { notificationsQueue };
export { SmtpProvider, WebhookProvider };

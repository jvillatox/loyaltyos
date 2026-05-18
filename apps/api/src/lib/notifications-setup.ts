import {
  createOneSignalProvider,
  createSmtpProvider,
  createTwilioProvider,
  NotificationsService,
  SmtpProvider,
  WebhookProvider,
} from "@loyaltyos/notifications";

import { prisma } from "../db.js";
import { createQueue } from "./queue.js";

/** Shared notifications service, configured with providers and BullMQ enqueue. */
export const notificationsService = new NotificationsService(prisma);

// Register EMAIL provider
notificationsService.setProvider("EMAIL", createSmtpProvider());

// Register SMS provider (no-op when env vars not set)
const smsProvider = createTwilioProvider();
if (smsProvider) {
  notificationsService.setProvider("SMS", smsProvider);
}

// Register PUSH provider (no-op when env vars not set)
const pushProvider = createOneSignalProvider();
if (pushProvider) {
  notificationsService.setProvider("PUSH", pushProvider);
}

// Wire BullMQ enqueue
const notificationsQueue = createQueue("notifications");

notificationsService.setEnqueue(async (notificationId: string) => {
  await notificationsQueue.add("send", { notificationId });
});

export { notificationsQueue };
export { SmtpProvider, WebhookProvider };

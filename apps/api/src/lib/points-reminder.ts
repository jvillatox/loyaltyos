import { PointsService } from "@loyaltyos/core";
import type { NotificationsService } from "@loyaltyos/notifications";

import { prisma } from "../db.js";
import { notificationsService } from "./notifications-setup.js";
import { resolvePortalUrl } from "./portal-url.js";

const points = new PointsService(prisma);

/**
 * Emails a 30-day-before expiry notice once per `(member, expiry date)`. The
 * deduplication lives in `PointsService.remindUpcomingExpiries`, which relies on
 * the `PointExpiryReminder` unique constraint. Members who opted out of EMAIL
 * get a `SKIPPED_OPT_OUT` notification instead of an email (the template is
 * non-transactional).
 */
export async function sendExpiryReminders(
  programId: string,
  now: Date = new Date(),
  notifications: NotificationsService = notificationsService,
): Promise<number> {
  return points.remindUpcomingExpiries(programId, now, async (deadline) => {
    const member = await prisma.member.findUnique({
      where: { id: deadline.memberId },
      select: { email: true, phone: true, firstName: true, lastName: true },
    });

    await notifications.sendTrigger(programId, "points.expiry_reminder", deadline.memberId, {
      amount: deadline.amount,
      mode: deadline.mode,
      date: deadline.expiresOn.toISOString(),
      portalUrl: resolvePortalUrl(programId),
      member: {
        id: deadline.memberId,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
      },
    });
  });
}

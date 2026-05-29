import { render } from "@loyaltyos/notifications";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { notificationsService as notifications } from "../../lib/notifications-setup.js";

// ── Schemas ──────────────────────────────────────────────────

const channelEnum = z.enum(["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"]);

const templateCreateBody = z.object({
  name: z.string().min(1).max(100),
  locale: z.string().optional(),
  channel: channelEnum,
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  triggerEvent: z.string().optional(),
  transactional: z.boolean().optional(),
  fallbackChannel: channelEnum.optional(),
});

const templateUpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  triggerEvent: z.string().optional(),
  transactional: z.boolean().optional(),
  fallbackChannel: channelEnum.optional().nullable(),
});

const webhookCreateBody = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  secret: z.string().min(16),
});

const webhookUpdateBody = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string().min(1)).optional(),
  secret: z.string().min(16).optional(),
  isActive: z.boolean().optional(),
});

function getProgramId(request: {
  programId: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  return request.programId || (request.headers["x-program-id"] as string) || "";
}

// ── Routes ───────────────────────────────────────────────────

export function adminNotificationsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  // ═══ Notification Templates ═══

  // GET /admin/notification-templates
  app.get("/admin/notification-templates", async (request, reply) => {
    const query = z
      .object({
        channel: z.enum(["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"]).optional(),
        triggerEvent: z.string().optional(),
        search: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const programId = getProgramId(request);
    const result = await notifications.listTemplates(programId, query);
    return reply.send({ data: result });
  });

  // POST /admin/notification-templates
  app.post("/admin/notification-templates", async (request, reply) => {
    const body = templateCreateBody.parse(request.body);
    const programId = getProgramId(request);
    const template = await notifications.createTemplate({
      ...body,
      programId,
    });
    await audit(
      programId,
      request.actor,
      "CREATE_NOTIFICATION_TEMPLATE",
      "NotificationTemplate",
      template.id,
      {
        name: body.name,
        channel: body.channel,
      },
    );
    return reply.status(201).send({ data: template });
  });

  // GET /admin/notification-templates/:id
  app.get("/admin/notification-templates/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const template = await notifications.getTemplate(id);
    return reply.send({ data: template });
  });

  // PATCH /admin/notification-templates/:id
  app.patch("/admin/notification-templates/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = templateUpdateBody.parse(request.body);
    const template = await notifications.updateTemplate(id, body);
    await audit(
      getProgramId(request),
      request.actor,
      "UPDATE_NOTIFICATION_TEMPLATE",
      "NotificationTemplate",
      id,
      body as Record<string, unknown>,
    );
    return reply.send({ data: template });
  });

  // DELETE /admin/notification-templates/:id
  app.delete("/admin/notification-templates/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await notifications.deleteTemplate(id);
    await audit(
      getProgramId(request),
      request.actor,
      "DELETE_NOTIFICATION_TEMPLATE",
      "NotificationTemplate",
      id,
    );
    return reply.status(204).send();
  });

  // POST /admin/notification-templates/:id/preview
  app.post("/admin/notification-templates/:id/preview", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { variables } = z
      .object({ variables: z.record(z.unknown()).optional().default({}) })
      .parse(request.body);

    const template = await notifications.getTemplate(id);
    const subject = template.subject ? render(template.subject, variables) : null;
    const bodyHtml = template.bodyHtml ? render(template.bodyHtml, variables) : null;
    const bodyText = template.bodyText ? render(template.bodyText, variables) : null;

    await audit(
      getProgramId(request),
      request.actor,
      "PREVIEW_NOTIFICATION_TEMPLATE",
      "NotificationTemplate",
      id,
      { variables },
    );

    return reply.send({ data: { subject, bodyHtml, bodyText } });
  });

  // POST /admin/notification-templates/:id/test-send
  app.post("/admin/notification-templates/:id/test-send", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { memberId, channel, recipient } = z
      .object({
        memberId: z.string().min(1).optional(),
        channel: z.enum(["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"]).optional(),
        recipient: z.string().optional(),
      })
      .parse(request.body);

    if (!memberId && !recipient) {
      return reply.status(400).send({
        error: { code: "INVALID_INPUT", message: "Either memberId or recipient is required" },
      });
    }

    const template = await notifications.getTemplate(id);
    const targetChannel = channel ?? template.channel;
    let context: Record<string, unknown> = {};
    let targetMemberId: string;
    const metadata: Record<string, unknown> = {};

    if (memberId) {
      // Load member data for variable interpolation
      const member = await prisma.member.findFirst({
        where: { id: memberId },
        include: {
          pointAccount: true,
          memberTiers: { include: { tier: true } },
        },
      });

      if (!member) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Member not found" } });
      }

      targetMemberId = member.id;
      const currentTier = member.memberTiers.find((mt) => !mt.downgradedAt)?.tier.name;

      context = {
        member: {
          id: member.id,
          email: member.email,
          phone: member.phone,
          firstName: member.firstName,
          lastName: member.lastName,
          tags: member.tags,
          currentTier,
        },
        points: member.pointAccount?.balance ?? 0,
        balance: member.pointAccount?.balance ?? 0,
      };

      if (member.email) metadata.email = member.email;
      if (member.phone) metadata.phone = member.phone;
    } else {
      // recipient present without memberId — pick any member for FK, deliver to recipient via metadata
      const fallbackMember = await prisma.member.findFirst({
        where: { programId: template.programId, deletedAt: null },
        select: { id: true },
      });
      if (!fallbackMember) {
        return reply.status(400).send({
          error: {
            code: "NO_MEMBERS",
            message: "Program has no members to anchor the test notification",
          },
        });
      }
      targetMemberId = fallbackMember.id;
      if (targetChannel === "EMAIL") metadata.email = recipient;
      if (targetChannel === "SMS") metadata.phone = recipient;
      if (targetChannel === "PUSH") metadata.deviceToken = recipient;
    }

    const subject = template.subject ? render(template.subject, context) : undefined;
    const body = template.bodyHtml
      ? render(template.bodyHtml, context)
      : template.bodyText
        ? render(template.bodyText, context)
        : undefined;

    const notification = await notifications.createNotification({
      templateId: template.id,
      memberId: targetMemberId,
      channel: targetChannel,
      subject,
      body,
      metadata,
    });

    // Try to send via provider
    try {
      await notifications.send(notification.id);
    } catch {
      // Leave as PENDING
    }

    await audit(
      getProgramId(request),
      request.actor,
      "SEND_TEST_NOTIFICATION",
      "Notification",
      notification.id,
      {
        templateId: id,
        memberId: targetMemberId,
        channel: targetChannel,
      },
    );

    return reply.status(201).send({ data: notification });
  });

  // ═══ Notifications ───────────────────────────────────────

  // GET /admin/notifications
  app.get("/admin/notifications", async (request, reply) => {
    const query = z
      .object({
        channel: z.enum(["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"]).optional(),
        status: z.enum(["PENDING", "SENT", "FAILED", "READ"]).optional(),
        memberId: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const programId = getProgramId(request);
    const result = await notifications.listNotifications(programId, query);
    return reply.send({ data: result });
  });

  // ═══ Webhooks ═══════════════════════════════════════════

  // GET /admin/webhooks
  app.get("/admin/webhooks", async (request, reply) => {
    const query = z
      .object({
        isActive: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const programId = getProgramId(request);
    const result = await notifications.listWebhooks(programId, query);
    return reply.send({ data: result });
  });

  // POST /admin/webhooks
  app.post("/admin/webhooks", async (request, reply) => {
    const body = webhookCreateBody.parse(request.body);
    const programId = getProgramId(request);
    const webhook = await notifications.createWebhook({
      ...body,
      programId,
    });
    await audit(programId, request.actor, "CREATE_WEBHOOK", "WebhookSubscription", webhook.id, {
      url: body.url,
      events: body.events,
    });
    return reply.status(201).send({ data: webhook });
  });

  // GET /admin/webhooks/:id
  app.get("/admin/webhooks/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const webhook = await notifications.getWebhook(id);
    return reply.send({ data: webhook });
  });

  // PATCH /admin/webhooks/:id
  app.patch("/admin/webhooks/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = webhookUpdateBody.parse(request.body);
    const webhook = await notifications.updateWebhook(id, body);
    await audit(
      getProgramId(request),
      request.actor,
      "UPDATE_WEBHOOK",
      "WebhookSubscription",
      id,
      body as Record<string, unknown>,
    );
    return reply.send({ data: webhook });
  });

  // DELETE /admin/webhooks/:id
  app.delete("/admin/webhooks/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await notifications.deleteWebhook(id);
    await audit(getProgramId(request), request.actor, "DELETE_WEBHOOK", "WebhookSubscription", id);
    return reply.status(204).send();
  });

  done();
}

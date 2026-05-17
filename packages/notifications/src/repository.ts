import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  NotificationCreateInput,
  NotificationRow,
  TemplateCreateInput,
  TemplateListFilters,
  TemplateRow,
  TemplateUpdateInput,
} from "./types.js";

interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export function createRepository(prisma: PrismaClient) {
  return {
    // Template CRUD
    async createTemplate(data: TemplateCreateInput): Promise<TemplateRow> {
      return prisma.notificationTemplate.create({ data });
    },

    async updateTemplate(id: string, data: TemplateUpdateInput): Promise<TemplateRow> {
      return prisma.notificationTemplate.update({ where: { id }, data });
    },

    async deleteTemplate(id: string): Promise<void> {
      await prisma.notificationTemplate.delete({ where: { id } });
    },

    async findTemplateById(id: string): Promise<TemplateRow | null> {
      return prisma.notificationTemplate.findFirst({ where: { id } });
    },

    async findTemplates(
      programId: string,
      filters: TemplateListFilters = {},
    ): Promise<{ items: TemplateRow[]; total: number }> {
      const where: Prisma.NotificationTemplateWhereInput = { programId };

      if (filters.channel) where.channel = filters.channel;
      if (filters.triggerEvent) where.triggerEvent = filters.triggerEvent;
      if (filters.search) {
        where.name = { contains: filters.search, mode: "insensitive" };
      }

      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;

      const [items, total] = await Promise.all([
        prisma.notificationTemplate.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.notificationTemplate.count({ where }),
      ]);

      return { items, total };
    },

    async findTemplatesByTrigger(programId: string, triggerEvent: string): Promise<TemplateRow[]> {
      return prisma.notificationTemplate.findMany({
        where: { programId, triggerEvent },
      });
    },

    // Notification
    async createNotification(data: NotificationCreateInput): Promise<NotificationRow> {
      return prisma.notification.create({
        data: {
          templateId: data.templateId,
          memberId: data.memberId,
          channel: data.channel,
          subject: data.subject,
          body: data.body,
          metadata: data.metadata as Prisma.InputJsonValue,
        },
      });
    },

    async findNotificationById(id: string): Promise<NotificationRow | null> {
      return prisma.notification.findFirst({ where: { id } });
    },

    async updateNotificationStatus(
      id: string,
      status: string,
      extra: { sentAt?: Date; error?: string } = {},
    ): Promise<NotificationRow> {
      return prisma.notification.update({
        where: { id },
        data: {
          status: status as never,
          ...(extra.sentAt !== undefined && { sentAt: extra.sentAt }),
          ...(extra.error !== undefined && { error: extra.error }),
        },
      });
    },

    async findNotificationsByMember(
      memberId: string,
      pagination?: PaginationParams,
    ): Promise<{ items: NotificationRow[]; total: number }> {
      const page = pagination?.page ?? 1;
      const pageSize = pagination?.pageSize ?? 20;

      const where: Prisma.NotificationWhereInput = { memberId };

      const [items, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.notification.count({ where }),
      ]);

      return { items, total };
    },

    // Webhook Subscriptions
    async createWebhook(data: {
      programId: string;
      url: string;
      events: string[];
      secret: string;
    }) {
      return prisma.webhookSubscription.create({ data });
    },

    async findWebhookById(id: string) {
      return prisma.webhookSubscription.findFirst({ where: { id } });
    },

    async findWebhooks(
      programId: string,
      filters: { isActive?: boolean; page?: number; pageSize?: number } = {},
    ) {
      const where: Prisma.WebhookSubscriptionWhereInput = { programId };
      if (filters.isActive !== undefined) where.isActive = filters.isActive;
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const [items, total] = await Promise.all([
        prisma.webhookSubscription.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.webhookSubscription.count({ where }),
      ]);
      return { items, total };
    },

    async updateWebhook(
      id: string,
      data: { url?: string; events?: string[]; secret?: string; isActive?: boolean },
    ) {
      return prisma.webhookSubscription.update({ where: { id }, data });
    },

    async deleteWebhook(id: string): Promise<void> {
      await prisma.webhookSubscription.delete({ where: { id } });
    },

    // Notification list (admin)
    async findNotifications(
      _programId: string,
      filters: {
        channel?: string;
        status?: string;
        memberId?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) {
      const where: Prisma.NotificationWhereInput = {};
      if (filters.channel) where.channel = filters.channel as never;
      if (filters.status) where.status = filters.status as never;
      if (filters.memberId) where.memberId = filters.memberId;
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const [items, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          include: { template: true },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.notification.count({ where }),
      ]);
      return { items, total };
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;

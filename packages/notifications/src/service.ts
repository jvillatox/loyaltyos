import type { NotificationChannel, PrismaClient } from "@prisma/client";

import { NoopProvider } from "./provider.js";
import { render } from "./renderer.js";
import { createRepository } from "./repository.js";
import { notificationCreateSchema, templateCreateSchema, templateUpdateSchema } from "./schemas.js";
import type {
  NotificationCreateInput,
  NotificationProvider,
  NotificationRow,
  TemplateCreateInput,
  TemplateListFilters,
  TemplateRow,
  TemplateUpdateInput,
} from "./types.js";
import {
  NotificationNotFoundError,
  ProviderNotFoundError,
  TemplateNotFoundError,
} from "./types.js";

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class NotificationsService {
  private repo: ReturnType<typeof createRepository>;
  private providers: Map<NotificationChannel, NotificationProvider>;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
    this.providers = new Map();
    // Default: noop for all channels
    for (const ch of ["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"] as const) {
      this.providers.set(ch, new NoopProvider(ch));
    }
  }

  setProvider(channel: NotificationChannel, provider: NotificationProvider): void {
    this.providers.set(channel, provider);
  }

  // ── Templates ──────────────────────────────────────────

  async createTemplate(input: TemplateCreateInput): Promise<TemplateRow> {
    const parsed = templateCreateSchema.parse(input) as TemplateCreateInput;
    return this.repo.createTemplate(parsed);
  }

  async updateTemplate(id: string, input: TemplateUpdateInput): Promise<TemplateRow> {
    const parsed = templateUpdateSchema.parse(input) as TemplateUpdateInput;
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new TemplateNotFoundError(id);
    return this.repo.updateTemplate(id, parsed);
  }

  async deleteTemplate(id: string): Promise<void> {
    const existing = await this.repo.findTemplateById(id);
    if (!existing) throw new TemplateNotFoundError(id);
    await this.repo.deleteTemplate(id);
  }

  async getTemplate(id: string): Promise<TemplateRow> {
    const template = await this.repo.findTemplateById(id);
    if (!template) throw new TemplateNotFoundError(id);
    return template;
  }

  async listTemplates(
    programId: string,
    filters: TemplateListFilters = {},
  ): Promise<PaginatedResult<TemplateRow>> {
    const { items, total } = await this.repo.findTemplates(programId, filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ── Notifications ──────────────────────────────────────

  async createNotification(input: NotificationCreateInput): Promise<NotificationRow> {
    const parsed = notificationCreateSchema.parse(input) as NotificationCreateInput;
    return this.repo.createNotification(parsed);
  }

  async sendTrigger(
    programId: string,
    triggerEvent: string,
    memberId: string,
    context: Record<string, unknown>,
  ): Promise<NotificationRow[]> {
    const templates = await this.repo.findTemplatesByTrigger(programId, triggerEvent);
    if (templates.length === 0) return [];

    const notifications: NotificationRow[] = [];

    for (const template of templates) {
      const body = template.bodyHtml
        ? render(template.bodyHtml, context)
        : template.bodyText
          ? render(template.bodyText, context)
          : undefined;
      const subject = template.subject ? render(template.subject, context) : undefined;

      const notification = await this.repo.createNotification({
        templateId: template.id,
        memberId,
        channel: template.channel,
        subject,
        body,
      });

      // Attempt to send immediately
      try {
        await this.send(notification.id);
        notifications.push(notification);
      } catch {
        // Leave as PENDING for retry
        notifications.push(notification);
      }
    }

    return notifications;
  }

  async send(id: string): Promise<NotificationRow> {
    const notification = await this.repo.findNotificationById(id);
    if (!notification) throw new NotificationNotFoundError(id);

    const provider = this.providers.get(notification.channel);
    if (!provider) throw new ProviderNotFoundError(notification.channel);

    const result = await provider.send(notification);

    if (result.success) {
      return this.repo.updateNotificationStatus(id, "SENT", {
        sentAt: new Date(),
      });
    }

    return this.repo.updateNotificationStatus(id, "FAILED", {
      error: result.error ?? "Unknown error",
    });
  }

  async markRead(id: string): Promise<NotificationRow> {
    const notification = await this.repo.findNotificationById(id);
    if (!notification) throw new NotificationNotFoundError(id);
    return this.repo.updateNotificationStatus(id, "READ");
  }

  async getMemberNotifications(
    memberId: string,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<PaginatedResult<NotificationRow>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 20;
    const { items, total } = await this.repo.findNotificationsByMember(memberId, {
      page,
      pageSize,
    });
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

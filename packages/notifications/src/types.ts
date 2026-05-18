import type {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
} from "@prisma/client";

export type { NotificationChannel, NotificationStatus };

export type TemplateRow = NotificationTemplate;
export type NotificationRow = Notification;

export interface TemplateCreateInput {
  programId: string;
  name: string;
  channel: NotificationChannel;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  triggerEvent?: string;
  transactional?: boolean;
  fallbackChannel?: NotificationChannel;
}

export interface TemplateUpdateInput {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  triggerEvent?: string;
  transactional?: boolean;
  fallbackChannel?: NotificationChannel | null;
}

export interface TemplateListFilters {
  channel?: NotificationChannel;
  triggerEvent?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface NotificationCreateInput {
  templateId?: string;
  memberId: string;
  channel: NotificationChannel;
  subject?: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(notification: NotificationRow): Promise<{ success: boolean; error?: string }>;
}

export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Notification template not found: ${id}`);
    this.name = "TemplateNotFoundError";
  }
}

export class NotificationNotFoundError extends Error {
  constructor(id: string) {
    super(`Notification not found: ${id}`);
    this.name = "NotificationNotFoundError";
  }
}

export class ProviderNotFoundError extends Error {
  constructor(channel: string) {
    super(`No provider registered for channel: ${channel}`);
    this.name = "ProviderNotFoundError";
  }
}

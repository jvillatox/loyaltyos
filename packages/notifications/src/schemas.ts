import { z } from "zod";

const channelEnum = z.enum(["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"]);

export const templateCreateSchema = z.object({
  programId: z.string().min(1),
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

export const templateUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  triggerEvent: z.string().optional(),
  transactional: z.boolean().optional(),
  fallbackChannel: channelEnum.optional().nullable(),
});

export const notificationCreateSchema = z.object({
  templateId: z.string().optional(),
  memberId: z.string().min(1),
  channel: channelEnum,
  subject: z.string().optional(),
  body: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

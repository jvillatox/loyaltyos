# @loyaltyos/notifications

Multi-channel notification engine for LoyaltyOS. Create templates, send notifications via triggers, and track delivery status.

## Features

- **Template management** — create reusable notification templates with Handlebars variable interpolation
- **Multi-channel** — EMAIL, SMS, PUSH, IN_APP, WEBHOOK
- **Trigger-based sending** — match templates by event type and auto-send
- **Provider abstraction** — pluggable providers per channel (SMTP, Webhook, Noop, Log)
- **Handlebars rendering** — `{{var}}`, `{{nested.path}}`, `{{#if}}`, `{{#each}}`, `{{#unless}}`, `{{eq}}`, `{{neq}}`
- **BullMQ integration** — async delivery with exponential retries and dead-letter queue
- **Status lifecycle** — PENDING → SENT / FAILED → READ

## Usage

```typescript
import { NotificationsService, createSmtpProvider } from "@loyaltyos/notifications";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma);

// Register SMTP provider for email delivery
notifications.setProvider("EMAIL", createSmtpProvider());

// Wire async queue delivery
notifications.setEnqueue(async (notificationId) => {
  await myQueue.add("send", { notificationId });
});

// Create a template
const template = await notifications.createTemplate({
  programId: "prog-1",
  name: "Welcome Email",
  channel: "EMAIL",
  subject: "Welcome, {{member.firstName}}!",
  bodyHtml:
    "<p>Hi {{member.firstName}}, you earned {{points}} points. Your balance is {{balance}}.</p>",
  triggerEvent: "points.earned",
});

// Send notifications when an event fires
const results = await notifications.sendTrigger("prog-1", "points.earned", "mem-1", {
  points: 500,
  balance: 1500,
  member: { firstName: "Jaime", email: "jaime@example.com" },
});
// Each notification is enqueued for async delivery

// Get member's notifications
const { items, total } = await notifications.getMemberNotifications("mem-1");
```

## Template Syntax (Handlebars)

```
Hi {{member.firstName}}, your balance is {{balance}} points.

{{#if member.currentTier}}
  Your tier: {{member.currentTier}}
{{else}}
  Start earning to unlock tiers!
{{/if}}

{{#each items}}
  - {{name}}: {{price}}
{{/each}}
```

Handlebars is sandboxed — dangerous globals like `constructor`, `__proto__`, `require`, `process`, `global` are blocked.

## Providers

### SmtpProvider

Uses nodemailer. Configure via environment:

```bash
SMTP_HOST=localhost     # default
SMTP_PORT=1025          # default (MailHog)
SMTP_USER=              # optional
SMTP_PASS=              # optional
SMTP_FROM=noreply@loyaltyos.dev  # default
```

### WebhookProvider

Sends signed HTTP callbacks with HMAC-SHA256:

```typescript
import { WebhookProvider } from "@loyaltyos/notifications";

const provider = new WebhookProvider({
  url: "https://partner.example.com/webhooks",
  secret: "whsec_...",
});

notifications.setProvider("WEBHOOK", provider);
```

Headers: `X-LoyaltyOS-Event`, `X-LoyaltyOS-Signature`, `X-LoyaltyOS-Timestamp`.

Verify incoming webhooks:

```typescript
const valid = WebhookProvider.verify(payload, signature, timestamp, secret);
```

### NoopProvider / LogProvider

Built-in for testing and debugging.

## API Reference

### `new NotificationsService(prisma: PrismaClient)`

Create a notifications service. All channels default to `NoopProvider`.

### Template Management

| Method                               | Description                                            |
| ------------------------------------ | ------------------------------------------------------ |
| `createTemplate(input)`              | Create a template                                      |
| `updateTemplate(id, input)`          | Partial update                                         |
| `deleteTemplate(id)`                 | Hard delete                                            |
| `getTemplate(id)`                    | Get by id                                              |
| `listTemplates(programId, filters?)` | Paginated list, filterable by channel and triggerEvent |

### Notification Operations

| Method                                                    | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `createNotification(input)`                               | Create a PENDING notification directly                         |
| `sendTrigger(programId, triggerEvent, memberId, context)` | Find matching templates, render, create and enqueue            |
| `send(id)`                                                | Enqueue notification (async) or send directly (no queue)       |
| `deliver(id)`                                             | Deliver notification via its channel provider (used by worker) |
| `markRead(id)`                                            | Mark notification as READ                                      |
| `getMemberNotifications(memberId, pagination?)`           | Paginated member notifications                                 |

### Provider Management

| Method                           | Description                              |
| -------------------------------- | ---------------------------------------- |
| `setProvider(channel, provider)` | Register a custom provider for a channel |
| `setEnqueue(fn)`                 | Set async enqueue callback for BullMQ    |

### Webhook Management

| Method                              | Description                 |
| ----------------------------------- | --------------------------- |
| `createWebhook(input)`              | Create webhook subscription |
| `getWebhook(id)`                    | Get by id                   |
| `listWebhooks(programId, filters?)` | Paginated list              |
| `updateWebhook(id, data)`           | Update webhook              |
| `deleteWebhook(id)`                 | Delete webhook              |

### Admin Notification List

| Method                                   | Description            |
| ---------------------------------------- | ---------------------- |
| `listNotifications(programId, filters?)` | Paginated list (admin) |

## End-to-End Flow

1. Admin creates a template via `POST /api/v1/admin/notification-templates`
2. An event fires (e.g., `points.earned`) → `sendTrigger()` finds matching templates
3. Templates are rendered with Handlebars using member context
4. Notifications are created as PENDING and enqueued to BullMQ
5. Worker picks up jobs, delivers via SMTP/Webhook provider
6. Status updated to SENT or FAILED (with retries)

## Errors

| Error class                 | When                               | HTTP |
| --------------------------- | ---------------------------------- | ---- |
| `TemplateNotFoundError`     | Template id doesn't exist          | 404  |
| `NotificationNotFoundError` | Notification id doesn't exist      | 404  |
| `ProviderNotFoundError`     | No provider registered for channel | 500  |

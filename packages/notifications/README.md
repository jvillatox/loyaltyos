# @loyaltyos/notifications

Multi-channel notification engine for LoyaltyOS. Create templates, send notifications via triggers, and track delivery status.

## Features

- **Template management** — create reusable notification templates with Handlebars-style variable interpolation
- **Multi-channel** — EMAIL, SMS, PUSH, IN_APP, WEBHOOK
- **Trigger-based sending** — match templates by event type and auto-send
- **Provider abstraction** — pluggable providers per channel with NoopProvider and LogProvider built-in
- **Status lifecycle** — PENDING → SENT / FAILED → READ

## Usage

```typescript
import { NotificationsService } from "@loyaltyos/notifications";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma);

// Create a template
const template = await notifications.createTemplate({
  programId: "prog-1",
  name: "Welcome Email",
  channel: "EMAIL",
  subject: "Welcome, {{firstName}}!",
  bodyHtml: "<p>Hi {{firstName}}, you've earned {{pointsAwarded}} points.</p>",
  triggerEvent: "registration",
});

// Send notifications when a registration event fires
const results = await notifications.sendTrigger("prog-1", "registration", "mem-1", {
  firstName: "Jaime",
  pointsAwarded: 500,
});
console.log(results.length); // 1 notification sent

// Get member's notifications
const { items, total } = await notifications.getMemberNotifications("mem-1");
console.log(`${total} notifications`);

// Register a custom provider
notifications.setProvider("EMAIL", {
  channel: "EMAIL",
  async send(notification) {
    // Call Resend, SendGrid, etc.
    return { success: true };
  },
});
```

## API Reference

### `new NotificationsService(prisma: PrismaClient)`

Create a notifications service. All channels default to `NoopProvider`.

### Template Management

| Method                               | Description                                            |
| ------------------------------------ | ------------------------------------------------------ |
| `createTemplate(input)`              | Create a template                                      |
| `updateTemplate(id, input)`          | Partial update                                         |
| `deleteTemplate(id)`                 | Hard delete (templates have no soft-delete)            |
| `getTemplate(id)`                    | Get by id                                              |
| `listTemplates(programId, filters?)` | Paginated list, filterable by channel and triggerEvent |

### Notification Operations

| Method                                                    | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `createNotification(input)`                               | Create a PENDING notification directly                         |
| `sendTrigger(programId, triggerEvent, memberId, context)` | Find matching templates, render, create and send notifications |
| `send(id)`                                                | Send a PENDING notification via its channel's provider         |
| `markRead(id)`                                            | Mark notification as READ                                      |
| `getMemberNotifications(memberId, pagination?)`           | Paginated member notifications                                 |

### Provider Management

| Method                           | Description                              |
| -------------------------------- | ---------------------------------------- |
| `setProvider(channel, provider)` | Register a custom provider for a channel |

## Template Variables

Templates use `{{variable}}` syntax. Supports nested paths with dot notation:

```
Hello {{firstName}}, your balance is {{balance}} points.
Your tier: {{tier.name}}
Address: {{metadata.city}}, {{metadata.country}}
```

Variables are resolved from the context object passed to `sendTrigger`. Missing variables are replaced with an empty string.

## Channels

| Channel | Description             | Default Provider |
| ------- | ----------------------- | ---------------- |
| EMAIL   | Email notifications     | NoopProvider     |
| SMS     | Text messages           | NoopProvider     |
| PUSH    | Push notifications      | NoopProvider     |
| IN_APP  | In-app widget messages  | NoopProvider     |
| WEBHOOK | External HTTP callbacks | NoopProvider     |

## Providers

Implement the `NotificationProvider` interface to integrate with real services:

```typescript
import type { NotificationProvider, NotificationRow } from "@loyaltyos/notifications";

const resendProvider: NotificationProvider = {
  channel: "EMAIL",
  async send(notification: NotificationRow) {
    try {
      await resend.emails.send({ ... });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

notifications.setProvider("EMAIL", resendProvider);
```

Built-in providers:

- **NoopProvider** — always returns success (default for all channels)
- **LogProvider** — logs to console and returns success (for debugging)

## Errors

| Error class                 | When                               | HTTP |
| --------------------------- | ---------------------------------- | ---- |
| `TemplateNotFoundError`     | Template id doesn't exist          | 404  |
| `NotificationNotFoundError` | Notification id doesn't exist      | 404  |
| `ProviderNotFoundError`     | No provider registered for channel | 500  |

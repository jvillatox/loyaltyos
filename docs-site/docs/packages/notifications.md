---
sidebar_position: 8
title: Notifications
---

# Notifications (`@loyaltyos/notifications`)

Multi-channel notification delivery engine.

## Channels

| Channel | Provider(s)                     |
| ------- | ------------------------------- |
| EMAIL   | Resend (production), SMTP (dev) |
| SMS     | Twilio REST API                 |
| PUSH    | OneSignal REST API              |
| WEBHOOK | HTTP POST with HMAC-SHA256      |
| IN_APP  | Stored-only (noop)              |

## Architecture

```
Event → sendTrigger() → Template Matching → Handlebars Render → Create Notification
                                                                       ↓
                                                              BullMQ Enqueue
                                                                       ↓
                                                              Worker: deliver()
                                                                       ↓
                                                    Provider (SMTP / Twilio / OneSignal / Webhook)
                                                                       ↓
                                                              Status: SENT or FAILED
```

## Templates

Handlebars syntax with sandboxed variable access:

```handlebars
<h1>Congratulations {{member.firstName}}!</h1>
<p>You earned <strong>{{points}}</strong> points. Your balance is now {{balance}}.</p>
```

Features:

- Create, update, preview, and test-send templates
- Template variables from event payload + member context
- Opt-out management per channel per member
- Transactional vs marketing classification

## Webhooks

Outgoing webhooks signed with HMAC-SHA256:

```bash
curl -X POST http://localhost:3002/api/v1/admin/webhooks \
  -H "X-API-Key: dev-key" -H "X-Program-Id: prog_dev" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://partner.example.com/webhooks", "events": ["points.earned"], "secret": "whsec_..."}'
```

See the [full README on GitHub](https://github.com/jvillatox/loyaltyos/blob/main/packages/notifications/README.md) for details.

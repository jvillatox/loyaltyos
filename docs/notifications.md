# Notifications

The notifications engine (`packages/notifications`) delivers multi-channel messages to members. Email, SMS, push, in-app, and webhooks — all from a single API with Handlebars templates.

## Architecture

```
Event → sendTrigger() → Template Matching → Handlebars Render → Create Notification (PENDING)
                                                                       ↓
                                                              BullMQ Enqueue
                                                                       ↓
                                                              Worker: deliver()
                                                                       ↓
                                                    Provider (SMTP / Twilio / OneSignal / Webhook)
                                                                       ↓
                                                              Status: SENT or FAILED
```

## Channels

| Channel | Provider(s)                          | Configuration                                                    |
| ------- | ------------------------------------ | ---------------------------------------------------------------- |
| EMAIL   | Resend (production), SMTP (dev)      | `RESEND_API_KEY`, `SMTP_*` env vars                              |
| SMS     | Twilio REST API                      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| PUSH    | OneSignal REST API                   | `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`                          |
| WEBHOOK | HTTP POST with HMAC-SHA256 signature | Per-webhook URL + secret                                         |
| IN_APP  | Noop (stored only)                   | —                                                                |

## Setup

### 1. Environment variables

```bash
# Email (Resend)
RESEND_API_KEY=re_xxxxxxxx

# Email (SMTP fallback for development)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=noreply@loyaltyos.dev

# SMS (Twilio)
TWILIO_ACCOUNT_SID=AC_xxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_API_BASE=          # optional override for testing

# Push (OneSignal)
ONESIGNAL_APP_ID=xxxxxxxx
ONESIGNAL_API_KEY=xxxxxxxx
ONESIGNAL_API_BASE=        # optional override for testing
```

### 2. Provider registration

The API app registers providers automatically from env vars. For custom setups:

```typescript
import {
  NotificationsService,
  createSmtpProvider,
  createTwilioProvider,
  createOneSignalProvider,
} from "@loyaltyos/notifications";

const notifications = new NotificationsService(prisma);

notifications.setProvider("EMAIL", createSmtpProvider());
notifications.setProvider("SMS", createTwilioProvider());
notifications.setProvider("PUSH", createOneSignalProvider());

// Wire async delivery via BullMQ
notifications.setEnqueue(async (notificationId) => {
  await notificationQueue.add("send", { notificationId });
});
```

### 3. Worker

Start the notification worker alongside the API:

```bash
pnpm --filter @loyaltyos/api dev:worker
```

The worker picks up queued notifications and delivers them through the configured providers with automatic retries.

## Templates

Templates use Handlebars syntax with sandboxed variable access.

### Create a template

```bash
curl -X POST http://localhost:3002/api/v1/admin/notification-templates \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Points Earned Email",
    "channel": "EMAIL",
    "subject": "You earned {{points}} points!",
    "bodyHtml": "<h1>Congratulations {{member.firstName}}!</h1><p>You earned <strong>{{points}}</strong> points. Your balance is now <strong>{{balance}}</strong>.</p>",
    "triggerEvent": "points.earned",
    "transactional": true
  }'
```

### Variable context

The template renderer receives a context object. Common variables:

| Variable                 | Source        | Description                 |
| ------------------------ | ------------- | --------------------------- |
| `{{member.id}}`          | Member record | Member ID                   |
| `{{member.email}}`       | Member record | Email address               |
| `{{member.phone}}`       | Member record | Phone number                |
| `{{member.firstName}}`   | Member record | First name                  |
| `{{member.lastName}}`    | Member record | Last name                   |
| `{{member.tags}}`        | Member record | Array of tags               |
| `{{member.currentTier}}` | Tier record   | Current tier name           |
| `{{points}}`             | Event payload | Points earned in this event |
| `{{balance}}`            | Event payload | Total balance after event   |

### Preview a template

```bash
curl -X POST http://localhost:3002/api/v1/admin/notification-templates/:id/preview \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev" \
  -H "Content-Type: application/json" \
  -d '{"variables": {"member": {"firstName": "Jane"}, "points": 500, "balance": 2500}}'
```

### Test-send

Send a real notification to a member or arbitrary recipient:

```bash
# Send to a member
curl -X POST http://localhost:3002/api/v1/admin/notification-templates/:id/test-send \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev" \
  -H "Content-Type: application/json" \
  -d '{"memberId": "mem_001"}'

# Send to an arbitrary email/phone (uses real member as FK anchor)
curl -X POST http://localhost:3002/api/v1/admin/notification-templates/:id/test-send \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev" \
  -H "Content-Type: application/json" \
  -d '{"channel": "EMAIL", "recipient": "test@example.com"}'
```

## Opt-Out Flow

Members can opt out per channel via the portal or API:

```bash
# Disable email notifications
curl -X PATCH http://localhost:3002/api/v1/members/me/preferences \
  -H "Cookie: session=..." \
  -H "Content-Type: application/json" \
  -d '{"EMAIL": false}'
```

Before sending, `sendTrigger()` calls `checkOptOut()`:

- **Transactional** notifications (password reset, verification) are always sent.
- **Non-transactional** notifications are skipped if the member has opted out of that channel.
- Skipped notifications are recorded as `SKIPPED_OPT_OUT` with the reason.

## Webhooks

Outgoing webhooks are signed with HMAC-SHA256:

```bash
curl -X POST http://localhost:3002/api/v1/admin/webhooks \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://partner.example.com/webhooks",
    "events": ["points.earned", "badge.unlocked"],
    "secret": "whsec_xxxxxxxxxxxxxxxx"
  }'
```

### Verifying incoming webhooks

On the receiving end, verify the signature:

```typescript
import { WebhookProvider } from "@loyaltyos/notifications";

const valid = WebhookProvider.verify(
  rawBody, // Raw request body string
  signature, // X-LoyaltyOS-Signature header
  timestamp, // X-LoyaltyOS-Timestamp header
  "whsec_...", // Your webhook secret
);

if (!valid) {
  throw new Error("Invalid signature");
}
```

Headers sent with each webhook:

| Header                  | Description                       |
| ----------------------- | --------------------------------- |
| `X-LoyaltyOS-Event`     | Event type (e.g. `points.earned`) |
| `X-LoyaltyOS-Signature` | HMAC-SHA256 signature             |
| `X-LoyaltyOS-Timestamp` | Unix timestamp of the request     |
| `Content-Type`          | `application/json`                |

## Delivery Status Lifecycle

```
PENDING → SENT
PENDING → FAILED → (retry) → SENT / FAILED
SENT → READ (member opens)
PENDING → SKIPPED_OPT_OUT (member opted out)
```

The worker retries failed deliveries up to 3 times with exponential backoff. After that, the notification stays in FAILED state.

## Testing

### MailHog (Email)

Development emails are captured by MailHog at http://localhost:8025. No real SMTP server needed.

### Twilio test credentials

Set `TWILIO_API_BASE` to a mock server URL for integration tests:

```bash
TWILIO_API_BASE=https://twilio-mock.local
```

### OneSignal test credentials

Set `ONESIGNAL_API_BASE` to a mock server URL:

```bash
ONESIGNAL_API_BASE=https://onesignal-mock.local
```

The `NoopProvider` and `LogProvider` are built-in for unit tests — no external dependencies needed.

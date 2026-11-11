---
sidebar_position: 3
title: Widget
---

# Loyalty Widget

The LoyaltyOS Widget (`apps/widget`) is an embeddable Web Component built with Lit. Add a loyalty panel to any website with a single script tag. Themes via CSS custom properties. ~45 KB gzipped.

## Security model

The widget never holds a long-lived credential. There are two scoped API keys, and only the safe one ever reaches the browser:

- **`SERVER` key** — full program access. **Never ship this to the browser.** It stays on your backend and is used only to mint short-lived member tokens.
- **`CLIENT` key** — read-only, public-catalog only. This is the key you embed in a page to show rewards to anonymous visitors.

A member is authenticated with a **short-lived, read-only member token** (`lomem_…`, default 15-minute TTL). Your backend issues it with the `SERVER` key and hands it to the widget via `setAuthToken()`. The widget sends it as `Authorization: Bearer lomem_…`.

## Quick Start

### Script tag

```html
<script type="module" src="https://cdn.example.com/loyalty-widget.js"></script>

<loyalty-widget
  program-id="prog_dev"
  api-base="https://api.example.com/api/v1"
  client-key="ck_live_…"
  mode="full"
></loyalty-widget>
```

### npm

```bash
pnpm add @loyaltyos/widget
```

```typescript
import "@loyaltyos/widget";
```

## Attributes

| Attribute      | Type    | Default     | Description                                                 |
| -------------- | ------- | ----------- | ----------------------------------------------------------- |
| `program-id`   | string  | —           | Program ID for multi-tenant scoping (required)              |
| `api-base`     | string  | —           | API base URL, must end in `/api/v1` (required)              |
| `auth-token`   | string  | —           | Short-lived member token (`lomem_…`) for authenticated view |
| `client-key`   | string  | —           | CLIENT key for the anonymous rewards catalog                |
| `theme`        | string  | `"auto"`    | `"light"`, `"dark"`, or `"auto"`                            |
| `accent-color` | string  | `"#7c3aed"` | Primary accent color                                        |
| `locale`       | string  | auto        | `"es-MX"` or `"en-US"` (alias: `data-lang`)                 |
| `compact`      | boolean | `false`     | Compact spacing                                             |
| `mode`         | string  | `"full"`    | Display mode: `"full"` or `"mini"`                          |

If `api-base` does not end in `/api/v1`, the widget logs a `console.warn`.

## Authenticating a member

The widget renders two views:

1. **Visitor view** (no `auth-token`) — shows the public rewards catalog (when a `client-key` is set) plus a "Sign in" button.
2. **Member view** (`auth-token` set) — shows points, badges, rewards, and tier.

Your backend issues the member token, then you hand it to the widget:

```javascript
const widget = document.querySelector("loyalty-widget");
widget.setAuthToken(memberToken); // switches to the member view
```

Pass `null` to return to the visitor view:

```javascript
widget.setAuthToken(null);
```

### Issuing a member token from your backend

`POST /api/v1/members/:id/session-token` is **SERVER-only**. It returns a `lomem_…` token that is read-only and expires (default 900 s, max 3600 s).

```bash
curl -X POST "https://api.example.com/api/v1/members/mem_001/session-token" \
  -H "x-api-key: sk_live_…" \
  -H "x-program-id: prog_dev" \
  -H "content-type: application/json" \
  -d '{"ttlSeconds": 900}'
```

Response:

```json
{
  "data": {
    "token": "lomem_…",
    "expiresAt": "2026-11-11T00:15:00.000Z",
    "memberId": "mem_001"
  }
}
```

Node (fetch):

```javascript
const res = await fetch("https://api.example.com/api/v1/members/mem_001/session-token", {
  method: "POST",
  headers: {
    "x-api-key": process.env.LOYALTYOS_SERVER_KEY,
    "x-program-id": process.env.LOYALTYOS_PROGRAM_ID,
    "content-type": "application/json",
  },
  body: JSON.stringify({ ttlSeconds: 900 }),
});

const { data } = await res.json();
// data.token -> hand to the widget via setAuthToken(data.token)
```

### Handling token expiry

Member tokens are short-lived by design. When a token is expired or revoked, the API returns `401` and the widget dispatches the `loyaltyos:auth-required` event. Listen for it as the moment to request a fresh token from your backend:

```javascript
widget.addEventListener("loyaltyos:auth-required", async () => {
  const token = await yourBackend.issueMemberToken();
  widget.setAuthToken(token);
});
```

## Display Modes

### Full mode (`mode="full"`)

Shows all sub-components: points card, tier card with progress bar, top 3 rewards, badges gallery.

### Mini mode (`mode="mini"`)

Compact single-card view with points balance and a quick "View rewards" link.

## Standalone Components

Each sub-component reads the same attributes from itself or its closest `loyalty-widget` ancestor:

```html
<loyalty-points-card
  program-id="prog_dev"
  api-base="https://api.example.com/api/v1"
  auth-token="lomem_…"
></loyalty-points-card>

<loyalty-tier-card
  program-id="prog_dev"
  api-base="https://api.example.com/api/v1"
  auth-token="lomem_…"
></loyalty-tier-card>

<loyalty-rewards-top3
  program-id="prog_dev"
  api-base="https://api.example.com/api/v1"
  client-key="ck_live_…"
></loyalty-rewards-top3>

<loyalty-badges-gallery
  program-id="prog_dev"
  api-base="https://api.example.com/api/v1"
  auth-token="lomem_…"
></loyalty-badges-gallery>
```

## Theming

Override CSS custom properties to match your brand:

```css
loyalty-widget {
  --loy-font-family: "Inter", sans-serif;
  --loy-color-primary: #7c3aed;
  --loy-color-primary-text: #ffffff;
  --loy-color-surface: #ffffff;
  --loy-color-text: #0f172a;
  --loy-color-text-secondary: #64748b;
  --loy-color-success: #16a34a;
  --loy-color-warning: #ea580c;
  --loy-radius-sm: 4px;
  --loy-radius-md: 8px;
  --loy-radius-lg: 12px;
  --loy-space-sm: 8px;
  --loy-space-md: 16px;
  --loy-space-lg: 24px;
}
```

## Events

| Event                     | When                                         |
| ------------------------- | -------------------------------------------- |
| `loyaltyos:auth-required` | The API returned 401 (token expired/revoked) |

## Build

```bash
pnpm --filter @loyaltyos/widget build
```

Output in `apps/widget/dist/`: `loyalty-widget.js` (ES module) and `loyalty-widget.umd.cjs` (UMD fallback).

## Browser Support

All modern browsers that support Web Components (Chrome, Firefox, Safari, Edge). No polyfills needed.

---
sidebar_position: 2
title: Customer Portal
---

# Customer Portal

The LoyaltyOS Customer Portal (`apps/portal`) is a mobile-first React PWA that lets members view their points balance, browse and redeem rewards, track badges, and manage notification preferences.

## Features

- **Magic-link auth** — passwordless login via email (Resend)
- **Home dashboard** — points balance, current tier with progress bar, top 3 rewards, unlocked badges
- **Rewards catalog** — browse all active rewards with category filter and wishlist (localStorage)
- **Badges gallery** — all badges with unlock status and progress percentage
- **Transaction history** — paginated list of point transactions
- **Profile** — notification preferences toggles (EMAIL, SMS, PUSH) and opt-out per channel
- **i18n** — English and Spanish, switchable in the UI
- **PWA** — installable on mobile devices with a web app manifest

## Quick Start

```bash
pnpm dev
```

Starts at **http://localhost:5174**.

## Environment Variables

```bash
# Auth (magic-link emails via Resend)
RESEND_API_KEY=re_your_resend_key

# The portal needs the API URL
VITE_API_URL=http://localhost:3002
```

## Auth Flow

1. Member enters email on the login screen.
2. API sends a magic link via email (Resend + SMTP fallback to MailHog in dev).
3. Member clicks the link → token is verified → session cookie is set.
4. Subsequent requests use the session cookie automatically.

In development, magic links appear in MailHog at http://localhost:8025.

## Pages

| Route           | Description                                       |
| --------------- | ------------------------------------------------- |
| `/`             | Home dashboard (balance, tier, rewards, badges)   |
| `/rewards`      | Rewards catalog with category filter and wishlist |
| `/rewards/:id`  | Reward detail with eligibility and redeem button  |
| `/badges`       | Badges gallery with progress bars                 |
| `/transactions` | Transaction history (paginated)                   |
| `/profile`      | Profile with notification preferences             |
| `/verify`       | Magic-link verification callback                  |

## Theming

Override CSS custom properties to match your brand:

```css
:root {
  --color-primary: #7c3aed;
  --color-primary-text: #ffffff;
  --color-surface: #ffffff;
  --color-surface-secondary: #f8fafc;
  --color-text: #0f172a;
  --color-text-secondary: #64748b;
  --color-border: #e2e8f0;
}
```

## i18n

Translation files in `apps/portal/src/i18n/`. Currently supported: English (`en.json`), Spanish (`es.json`). Add new languages by creating a new JSON file and registering it in the i18n config.

# Customer Portal

The LoyaltyOS Customer Portal (`apps/portal`) is a mobile-first React PWA that lets members view their points balance, browse and redeem rewards, track badges, and manage notification preferences.

## Features

- **Magic-link auth** — passwordless login via email (Resend). No password to remember or store.
- **Home dashboard** — points balance (confirmed + pending), current tier with progress bar to next tier, top 3 rewards, and unlocked badges.
- **Rewards catalog** — browse all active rewards with category filter and wishlist (localStorage). Reward detail shows eligibility (points needed, tier requirement, stock) and a Redeem button.
- **Badges gallery** — all badges with unlock status and progress percentage.
- **Transaction history** — paginated list of point transactions.
- **Profile** — notification preferences toggles (EMAIL, SMS, PUSH) and opt-out per channel.
- **i18n** — English and Spanish, switchable in the UI.
- **PWA** — installable on mobile devices with a web app manifest.

## Quick Start

The portal is part of the monorepo dev command:

```bash
pnpm dev
```

Starts at **http://localhost:5174**.

## Environment Variables

Copy from the API `.env.example`:

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

```typescript
// Login request
POST /api/v1/auth/login
{ "email": "member@example.com", "programId": "prog_dev" }

// Verify token (called by the magic-link page)
GET /api/v1/auth/verify?token=...&programId=prog_dev
```

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

## API Endpoints Used

The portal calls these public API endpoints (auth required):

| Endpoint                               | Used By       |
| -------------------------------------- | ------------- |
| `GET /api/v1/members/me/balance`       | Home          |
| `GET /api/v1/members/me/tier`          | Home          |
| `GET /api/v1/members/me/badges`        | Home, Badges  |
| `GET /api/v1/rewards`                  | Home, Catalog |
| `GET /api/v1/rewards/:id`              | Reward Detail |
| `POST /api/v1/rewards/:id/redeem`      | Redemption    |
| `GET /api/v1/members/me/transactions`  | Transactions  |
| `GET /api/v1/members/me/preferences`   | Profile       |
| `PATCH /api/v1/members/me/preferences` | Profile       |

## Theming

The portal uses CSS custom properties for branding. Override these in your stylesheet:

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

Translation files are in `packages/i18n/src/locales/`. Currently supported:

- English (`en-US.json`)
- Spanish (`es-MX.json`)

Locale resolution follows a priority chain per surface. See [Localization](localization.md) for details on adding new languages, resolution order, and template authoring.

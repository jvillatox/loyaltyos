# Architecture & Repository Structure

> Final tree for LoyaltyOS v1.0.0.

## Repository Tree

```
loyaltyos/
├── .commitlintrc.json
├── .dockerignore
├── .env
├── .env.example
├── .eslintrc.cjs
├── .github/
│   └── workflows/
│       ├── ci.yml                    # typecheck, lint, test (PG + Redis services)
│       ├── docker.yml                # build + push API/Admin/Portal to GHCR
│       └── docs.yml                  # Docusaurus deploy to GitHub Pages
├── .husky/
│   ├── commit-msg                    # commitlint hook
│   └── pre-commit                    # ESLint + Prettier
├── .prettierrc
├── CLAUDE.md                         # Project brief for AI coding assistants
├── CONTRIBUTING.md
├── CHANGELOG.md                      # Full release history (0.1.0 to 1.0.0)
├── LICENSE                           # MIT
├── NOTES.md                          # Known dependency notes (Fastify 4.x audit)
├── README.md
├── SECURITY.md                       # Responsible disclosure policy
├── apps/
│   ├── admin/                        # Admin Dashboard (React 18 + Vite + shadcn/ui)
│   │   ├── Dockerfile
│   │   ├── nginx.conf
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── app-layout.tsx
│   │   │   │   │   └── sidebar.tsx
│   │   │   │   └── ui/               # 24 shadcn/ui components
│   │   │   │       ├── accordion.tsx
│   │   │   │       ├── alert-dialog.tsx
│   │   │   │       ├── badge.tsx
│   │   │   │       ├── button.tsx
│   │   │   │       ├── calendar.tsx
│   │   │   │       ├── card.tsx
│   │   │   │       ├── checkbox.tsx
│   │   │   │       ├── command.tsx
│   │   │   │       ├── dialog.tsx
│   │   │   │       ├── dropdown-menu.tsx
│   │   │   │       ├── input.tsx
│   │   │   │       ├── label.tsx
│   │   │   │       ├── popover.tsx
│   │   │   │       ├── progress.tsx
│   │   │   │       ├── radio-group.tsx
│   │   │   │       ├── select.tsx
│   │   │   │       ├── separator.tsx
│   │   │   │       ├── skeleton.tsx
│   │   │   │       ├── switch.tsx
│   │   │   │       ├── table.tsx
│   │   │   │       ├── tabs.tsx
│   │   │   │       ├── textarea.tsx
│   │   │   │       └── tooltip.tsx
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   └── utils.ts
│   │   │   ├── pages/
│   │   │   │   ├── badge-editor.tsx
│   │   │   │   ├── badges-list.tsx
│   │   │   │   ├── campaign-builder.tsx   # 6-step wizard
│   │   │   │   ├── campaigns-list.tsx
│   │   │   │   ├── coalition/
│   │   │   │   │   ├── config.tsx
│   │   │   │   │   ├── linked-members.tsx
│   │   │   │   │   └── transactions.tsx
│   │   │   │   ├── coupon-bulk-generate.tsx
│   │   │   │   ├── coupons-list.tsx
│   │   │   │   ├── dashboard.tsx          # KPI cards
│   │   │   │   ├── member-detail.tsx
│   │   │   │   ├── members-list.tsx
│   │   │   │   ├── rewards/
│   │   │   │   │   ├── rewards-editor.tsx
│   │   │   │   │   ├── rewards-list.tsx
│   │   │   │   │   └── rewards-redemptions.tsx
│   │   │   │   ├── segment-builder.tsx     # Visual rule editor
│   │   │   │   ├── segments-list.tsx
│   │   │   │   └── tiers-list.tsx          # Pyramid visualization
│   │   │   ├── main.tsx
│   │   │   └── types.ts
│   │   ├── tailwind.config.cjs
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   ├── api/                        # REST API (Fastify 4 + Prisma + Zod)
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh
│   │   ├── package.json
│   │   ├── prisma/
│   │   │   ├── migrations/         # 8 migration folders
│   │   │   ├── schema.prisma       # Multi-tenant data model
│   │   │   └── seed.ts             # Demo data (12 members, tiers, campaigns...)
│   │   ├── src/
│   │   │   ├── app.ts              # Fastify app with Helmet, CORS, rate limiting
│   │   │   ├── db.ts
│   │   │   ├── index.ts            # Entry point
│   │   │   ├── worker.ts           # BullMQ worker entry point
│   │   │   ├── __tests__/
│   │   │   │   ├── audit.test.ts
│   │   │   │   ├── auth.test.ts
│   │   │   │   ├── campaigns.test.ts
│   │   │   │   ├── coalition.test.ts
│   │   │   │   └── coupons.test.ts
│   │   │   ├── lib/
│   │   │   │   ├── audit.ts
│   │   │   │   ├── auth/
│   │   │   │   │   └── lucia.ts
│   │   │   │   ├── coalition-setup.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── notifications-setup.ts
│   │   │   │   ├── queue.ts
│   │   │   │   └── redis-cache.ts
│   │   │   ├── plugins/
│   │   │   │   └── auth.ts         # API key + session auth plugin
│   │   │   ├── routes/
│   │   │   │   ├── admin/
│   │   │   │   │   ├── badges.ts
│   │   │   │   │   ├── campaigns.ts
│   │   │   │   │   ├── coalition.ts
│   │   │   │   │   ├── coupons.ts
│   │   │   │   │   ├── notifications.ts
│   │   │   │   │   ├── rewards.ts
│   │   │   │   │   ├── segments.ts
│   │   │   │   │   └── tiers.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── coalition.ts
│   │   │   │   ├── coupons.ts
│   │   │   │   ├── events.ts
│   │   │   │   ├── health.ts
│   │   │   │   ├── members.ts
│   │   │   │   ├── rewards.ts
│   │   │   │   └── stats.ts
│   │   │   └── workers/
│   │   │       └── notifications.ts
│   │   └── tsconfig.json
│   ├── portal/                     # Customer Portal (React PWA + i18n)
│   │   ├── Dockerfile
│   │   ├── nginx.conf
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── __tests__/
│   │   │   ├── components/
│   │   │   │   └── layout/
│   │   │   │       ├── app-layout.tsx
│   │   │   │       └── bottom-nav.tsx
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── i18n.ts         # bootstrapLocale, setUserLocale
│   │   │   │   └── theme.ts
│   │   │   ├── pages/
│   │   │   │   ├── badges.tsx      # Badges gallery with progress
│   │   │   │   ├── home.tsx        # Dashboard: balance, tier, rewards, badges
│   │   │   │   ├── profile.tsx     # Notification preferences
│   │   │   │   ├── reward-detail.tsx
│   │   │   │   ├── rewards.tsx     # Catalog with wishlist
│   │   │   │   ├── transactions.tsx
│   │   │   │   └── verify.tsx      # Magic-link verification
│   │   │   └── types.ts
│   │   ├── tailwind.config.cjs
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── vitest.config.ts
│   └── widget/                     # Loyalty Widget (Lit Web Components)
│       ├── demo/
│       │   └── index.html
│       ├── package.json
│       ├── src/
│       │   ├── __tests__/
│       │   │   ├── api-client.test.ts
│       │   │   ├── loyalty-points-card.test.ts
│       │   │   └── loyalty-widget.test.ts
│       │   ├── components/
│       │   │   ├── loyalty-badges-gallery.ts
│       │   │   ├── loyalty-points-card.ts
│       │   │   ├── loyalty-rewards-top3.ts
│       │   │   ├── loyalty-tier-card.ts
│       │   │   ├── loyalty-widget.ts    # Main component (mini/full modes)
│       │   │   └── ui/
│       │   │       ├── empty-state.ts
│       │   │       ├── error-message.ts
│       │   │       └── spinner.ts
│       │   ├── index.ts
│       │   ├── lib/
│       │   │   ├── api-client.ts
│       │   │   ├── format.ts
│       │   │   └── widget-config.ts
│       │   ├── styles/
│       │   │   └── tokens.css           # CSS custom properties
│       │   └── types.ts
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── vitest.config.ts
├── docker-compose.yml                  # Dev infra: PG 15, Redis 7, MailHog, Adminer
├── docs/                               # Architecture & guides (source of truth)
│   ├── SPEC.md                         # Full project spec
│   ├── architecture.md                 # This file
│   ├── coalition.md                    # Coalition architecture & adapter guide
│   ├── coalition-apprecio.md           # Apprecio adapter deep-dive
│   ├── customer-portal.md              # Customer portal guide
│   ├── data-model.md                   # Database schema reference
│   ├── development.md                  # Development setup guide
│   ├── notifications.md                # Notifications setup guide
│   └── widget-integration.md           # Widget integration guide
├── docs-site/                          # Docusaurus 3 documentation site
│   ├── docusaurus.config.ts
│   ├── sidebars.ts
│   ├── package.json
│   ├── static/
│   │   └── img/
│   │       └── logo.svg                # Violet/indigo gradient star logo
│   └── docs/                           # 27 pages across 7 sections
├── infra/
│   ├── docker/                         # Production Docker Compose
│   │   ├── .env.production.example
│   │   ├── docker-compose.prod.yml     # API + Worker + PG + Redis + Prometheus + OTEL
│   │   ├── otel-collector-config.yml
│   │   └── prometheus.yml
│   ├── grafana/
│   │   └── dashboards/
│   │       ├── api-overview.json       # HTTP RPS, latency, errors
│   │       └── bullmq-queues.json      # Queue depth, duration, throughput
│   └── k8s/
│       ├── README.md
│       └── helm/
│           └── loyaltyos/
│               ├── Chart.yaml          # v1.0.0, icon, dependencies
│               ├── Chart.lock
│               ├── values.yaml         # Full configuration
│               ├── charts/
│               │   ├── postgresql-16.7.27.tgz
│               │   └── redis-20.13.4.tgz
│               └── templates/          # 19 templates
│                   ├── _helpers.tpl
│                   ├── configmap.yaml
│                   ├── deployment-api.yaml
│                   ├── deployment-admin.yaml
│                   ├── deployment-bullmq-worker.yaml
│                   ├── deployment-portal.yaml
│                   ├── hpa-api.yaml
│                   ├── ingress.yaml
│                   ├── job-migrations.yaml
│                   ├── networkpolicy.yaml
│                   ├── pdb-api.yaml
│                   ├── rbac.yaml
│                   ├── secret.yaml
│                   ├── serviceaccount.yaml
│                   ├── service-api.yaml
│                   ├── service-admin.yaml
│                   ├── service-portal.yaml
│                   └── servicemonitor.yaml
├── packages/
│   ├── badges/                     # Badges engine + Tiers
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── badge-conditions.ts     # Condition DSL + temporal operators
│   │       ├── badges-service.ts       # 5 badge types, progress tracking
│   │       ├── tiers-service.ts        # Rank hierarchy, upgrade/downgrade
│   │       ├── repository.ts
│   │       ├── types.ts
│   │       └── __tests__/
│   ├── campaigns/                  # Campaign rules engine
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts              # 8 campaign types, budget capping
│   │       ├── ab-testing.ts           # CampaignVariant A/B testing
│   │       ├── rules.ts                # Stacking rules engine
│   │       ├── repository.ts
│   │       ├── schemas.ts
│   │       ├── types.ts
│   │       └── __tests__/
│   ├── coalition/                  # Coalition adapter (Apprecio + generic)
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts              # Two-phase commit, circuit breaker
│   │       ├── crypto.ts               # AES-256-GCM credential encryption
│   │       ├── repository.ts
│   │       ├── types.ts
│   │       ├── adapters/
│   │       │   ├── apprecio.ts         # Apprecio API (MX, CL, PE, CO, EC)
│   │       │   ├── apprecio.types.ts
│   │       │   └── __tests__/
│   │       └── __tests__/
│   ├── config-eslint/              # Shared ESLint config
│   ├── config-prettier/            # Shared Prettier config
│   ├── core/                       # Points engine (immutable ledger)
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts              # accumulate, redeem, expire, adjust, reverse
│   │       ├── ledger.ts               # Immutable transaction ledger
│   │       ├── rules.ts                # Multiplier rules engine
│   │       ├── repository.ts
│   │       ├── types.ts
│   │       └── __tests__/
│   ├── i18n/                       # Shared translations (es-MX, en-US)
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── catalog.ts
│   │       ├── detect.ts
│   │       ├── format.ts
│   │       ├── locales.ts
│   │       └── locales/
│   │           ├── es-MX.json
│   │           └── en-US.json
│   ├── coupons/                    # Coupon system
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts              # 6 discount types, 3 modes
│   │       ├── repository.ts
│   │       ├── schemas.ts
│   │       ├── types.ts
│   │       └── __tests__/
│   ├── notifications/              # Multi-channel notifications
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts
│   │       ├── provider.ts
│   │       ├── renderer.ts             # Handlebars sandboxed rendering
│   │       ├── repository.ts
│   │       ├── schemas.ts
│   │       ├── types.ts
│   │       ├── providers/
│   │       │   ├── onesignal.ts        # Push notifications
│   │       │   ├── smtp.ts             # Email (Resend)
│   │       │   ├── twilio.ts           # SMS
│   │       │   └── webhook.ts          # Webhook with HMAC-SHA256 signing
│   │       └── __tests__/
│   ├── rewards/                    # Rewards catalog + redemption
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts              # 6 categories, eligibility, stock
│   │       ├── repository.ts
│   │       ├── schemas.ts
│   │       ├── types.ts
│   │       └── __tests__/
│   ├── segments/                   # Dynamic segmentation
│   │   ├── README.md
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── service.ts
│   │       ├── rule-evaluator.ts       # DSL evaluator (eq, neq, gt, contains...)
│   │       ├── repository.ts
│   │       ├── schemas.ts
│   │       ├── types.ts
│   │       └── __tests__/
│   └── telemetry/                  # OpenTelemetry + Prometheus
│       ├── README.md
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── metrics.ts              # MetricsRegistry, HTTP + BullMQ metrics
│           ├── fastify-metrics-plugin.ts
│           ├── tracing.ts              # initTracing (HTTP, PG, Redis auto-instrumentation)
│           └── __tests__/
├── package.json                    # Root: Turborepo + pnpm workspaces
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── turbo.json
```

## Architecture Overview

LoyaltyOS follows a modular monorepo pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Admin UI │  │  Portal  │  │  Widget  │  │  External   │  │
│  │  React   │  │  PWA     │  │  Lit WC  │  │  REST       │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
└───────┼─────────────┼─────────────┼───────────────┼─────────┘
        │             │             │               │
        └─────────────┼─────────────┼───────────────┘
                      │             │
              ┌───────▼─────────────▼──────┐
              │      API Layer             │
              │  Fastify 4 + Zod + Swagger │
              │  Helmet + CORS + Rate Limit│
              │  Auth (API Key + Session)  │
              └─────────────┬──────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
  ┌─────▼─────┐  ┌──────────▼─────┐  ┌─────────▼──────┐
  │  Core     │  │  Engagement    │  │  Gamification   │
  │  Points   │  │  Campaigns     │  │  Badges+Tiers   │
  │  Engine   │  │  Coupons       │  │  Rewards        │
  │           │  │  Segments      │  │                 │
  │           │  │  Notifications │  │                 │
  └─────┬─────┘  └──────────┬─────┘  └─────────┬──────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
  ┌─────▼─────┐  ┌──────────▼─────┐  ┌─────────▼──────┐
  │Coalition  │  │  Observability │  │  Data Layer     │
  │Apprecio   │  │  OTel+Prom     │  │  PG + Redis     │
  │+ Generic  │  │  +Grafana      │  │  + BullMQ       │
  └───────────┘  └────────────────┘  └─────────────────┘
```

### Key Architectural Decisions

1. **Immutable Ledger** — Point transactions are append-only. Reversals use contra-entries, never deletes. This guarantees auditability.

2. **Two-Phase Commit (Coalition)** — All cross-system operations use PENDING → CONFIRMED/FAILED pattern. If the external coalition call succeeds but the local ledger write fails, a compensation reversal is issued.

3. **Idempotency Keys** — Critical operations (accumulate, redeem, convert, adjust) require an `Idempotency-Key` header. Results are cached for 24h so retries are safe.

4. **Multi-Tenant Isolation** — Every API request requires `X-API-Key` + `X-Program-Id` headers. The auth plugin enforces program-level data isolation at the API layer — no program can access another program's data.

5. **Event-Driven** — Business logic triggers from ingested events (purchase, registration, referral, etc.). The events endpoint is the primary integration point for external systems.

6. **Pluggable Coalition** — The `CoalitionAdapter` interface supports arbitrary providers. Switching from Apprecio to another coalition network requires implementing 5 methods and setting a config value.

7. **Stateless API + External Worker** — The API is stateless (scales horizontally). The BullMQ worker runs as a separate process for async tasks (notifications, campaign evaluation, tier downgrades).

### Package Dependency Graph

```
@loyaltyos/api
├── @loyaltyos/core
├── @loyaltyos/campaigns
├── @loyaltyos/coupons
├── @loyaltyos/segments
├── @loyaltyos/badges        (badges + tiers)
├── @loyaltyos/rewards
├── @loyaltyos/coalition
├── @loyaltyos/notifications
└── @loyaltyos/telemetry
```

### Technology Stack Summary

| Concern       | Technology                             |
| ------------- | -------------------------------------- |
| Runtime       | Node.js 20 LTS                         |
| API Framework | Fastify 4                              |
| ORM           | Prisma                                 |
| Database      | PostgreSQL 15                          |
| Cache / Queue | Redis 7 / BullMQ                       |
| Auth          | Lucia Auth (magic-link, sessions)      |
| Validation    | Zod (every API boundary)               |
| Admin UI      | React 18 + Vite + shadcn/ui + Tailwind |
| Portal        | React 18 + Vite + i18next + PWA        |
| Widget        | Lit 3 Web Components                   |
| Charts        | Recharts                               |
| Email         | Resend + pluggable SMTP adapter        |
| SMS           | Twilio                                 |
| Push          | OneSignal                              |
| Tracing       | OpenTelemetry (HTTP, PG, Redis)        |
| Metrics       | Prometheus (HTTP, BullMQ, Node.js)     |
| Dashboards    | Grafana                                |
| Monorepo      | Turborepo + pnpm workspaces            |
| CI/CD         | GitHub Actions                         |
| Container     | Docker + Docker Compose                |
| Orchestration | Kubernetes (Helm)                      |
| Docs          | Docusaurus 3                           |

## Design Principles

- **API-first** — everything the Admin UI does is available via REST.
- **Immutable ledger** — point transactions are never deleted. Reversals use contra-entries.
- **Idempotent** — critical operations require an `Idempotency-Key` header.
- **Multi-tenant** — program-scoped data isolation enforced at the API layer.
- **Event-driven** — business logic triggers from events (purchase, registration, etc.).
- **Modular** — each subsystem is an independent package that can be enabled or disabled.
- **Zod validation** on every API boundary — no unvalidated input reaches business logic.
- **Credential encryption** — coalition provider credentials are AES-256-GCM encrypted at rest.
- **Webhook signing** — HMAC-SHA256 with time-bounded tolerance (5 min).
- **Passwordless auth** — magic-link only; no passwords are stored or transmitted.

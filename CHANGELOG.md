# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-16

### Added

- **Campaigns engine (`packages/campaigns`)** — 8 campaign types (Bonus Points, Spend & Get, Frequency, Milestone, Referral, Birthday, Anniversary, Flash Sale, Tier Upgrade) with budget capping, stacking rules, A/B testing, and impact estimation.
- **Campaigns admin API** — CRUD endpoints, lifecycle management (activate / pause / archive), and campaign-to-event matching pipeline.
- **Campaign Builder UI** — 6-step wizard (type → audience → rules → channels → dates → review) with impact estimation card.
- **Campaigns list UI** — table with type badge, status badge, budget, dates, and dropdown actions (edit, activate, pause, archive).
- **Coupons engine (`packages/coupons`)** — 6 discount types (Percentage, Fixed, Free Product, Free Shipping, Extra Points, Experience), 3 modes (Shared, Individual, Limited), usage tracking, expiry, and stacking control.
- **Coupons admin API** — CRUD, bulk generation, and real-time usage stats.
- **Coupons list UI** — table with mode filter, usage column (used/max), status badge, and delete action.
- **Coupon bulk generate UI** — form with prefix, count, length, discount config, channels, and schedule; generated codes displayed in scrollable grid with copy-to-clipboard.
- **Segments engine (`packages/segments`)** — dynamic rule DSL with operators (eq, neq, gt, gte, lt, lte, between, contains, in), recursive AND/OR groups, and segment materialization / evaluation.
- **Segments admin API** — CRUD, evaluate count, and member management (add/remove for static segments).
- **Segments list UI** — table with type filter (Dynamic / Static), member count, status, and edit/delete actions.
- **Segment Builder UI** — visual rule builder with Accordion groups, AND/OR toggle, field/operator/value condition rows, real-time member count estimation. Static mode with member ID textarea.
- **Notifications (`packages/notifications`)** — multi-channel delivery (Email, SMS, Push, In-App, Webhook), template rendering with `{{variable}}` dot-notation interpolation, provider abstraction (Resend, Courier, Noop, Log), and notification service with audit trail.
- **Admin sidebar navigation** — new links for Campaigns, Coupons, and Segments.
- **13 new shadcn/ui components** — Accordion, AlertDialog, Calendar, Checkbox, Command, DropdownMenu, Popover, Progress, RadioGroup, Switch, Tabs, Textarea, Tooltip.

## [0.1.0] - 2026-05-15

### Added

- **Monorepo scaffold** — Turborepo + pnpm workspaces with TypeScript strict, ESLint, Prettier, Husky, and commitlint.
- **Database schema** — Prisma ORM with full multi-tenant data model: programs, members, point accounts, immutable transaction ledger, tiers, campaigns, coupons, rewards, badges, coalition accounts, notifications, audit log, and webhooks.
- **Docker Compose** — local dev infrastructure with PostgreSQL 15, Redis 7, MailHog, and Adminer.
- **Points engine (`packages/core`)** — accumulate, redeem, expire, adjust, and reverse operations with idempotency-key support, rule-based multipliers, and pending/confirmed balance tracking.
- **REST API (`apps/api`)** — Fastify 5 with Zod validation, API key auth (multi-tenant via `X-Program-Id`), rate limiting, CORS, Swagger docs at `/docs`, and CRUD endpoints for members, events, stats, and balance queries.
- **Admin UI (`apps/admin`)** — React 18 + Vite + shadcn/ui + TanStack Query. Dashboard with KPI cards, member list with search and pagination, member detail with balance and transaction history, and manual point adjustments with idempotency-key support.
- **Seed script** — demo program with 12 members, 3 tiers, 2 campaigns, 2 coupons, 3 rewards, 2 badges, and realistic point transactions.
- **Widget scaffold (`apps/widget`)** — Vite + Lit project for embeddable loyalty widget (UI coming in Phase 3).
- **Documentation** — professional README with quick start, architecture overview, API reference, and roadmap. CONTRIBUTING.md with conventions and pull request checklist.

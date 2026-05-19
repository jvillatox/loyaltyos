# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-19

### Added

- **Badges engine (`packages/badges`)** — 5 badge types (Achievement, Status, Temporal, Collectible, Social) with condition DSL, temporal operators (`count_in_window`, `within`, `since`), progress tracking (0-100%), and event-driven auto-evaluation.
- **Tiers engine (`packages/badges`)** — configurable rank hierarchy with threshold-based upgrades, inactivity downgrade job, progress-to-next-tier tracking, and tier benefits.
- **Badges admin API** — CRUD endpoints, manual award, member badge list with progress, badge distribution stats.
- **Tiers admin API** — CRUD, reorder, tier stats (member count per tier), member tier evaluation.
- **Badges admin UI** — list with type filter, editor with condition config, image upload.
- **Tiers admin UI** — list with inline editing, color picker, drag-to-reorder, pyramid visualization.
- **Rewards engine (`packages/rewards`)** — 6 categories (Discount, Physical Product, Gift Card, Experience, Charity, Coalition Transfer), eligibility checks (points, tier, stock), stock management, and idempotent redemption.
- **Rewards admin API** — CRUD, publish/archive, restock, redemptions history.
- **Rewards admin UI** — table/grid toggle view with category badges, editor, redemptions log.
- **Customer Portal (`apps/portal`)** — React 18 + Vite + Tailwind with magic-link auth (Lucia), i18n (en/es), home dashboard (balance, tier progress, top rewards, badges), rewards catalog with wishlist and category filter, reward detail with eligibility and redeem, badges gallery with progress, transaction history, profile with notification preferences, and PWA manifest.
- **Loyalty Widget (`apps/widget`)** — Lit Web Components: `<loyalty-widget>` (full/mini modes), `<loyalty-points-card>`, `<loyalty-tier-card>`, `<loyalty-rewards-top3>`, `<loyalty-badges-gallery>`. Themeable via CSS custom properties, sub-50 KB bundle.
- **Magic-link auth** — passwordless login via email magic links (Resend), session cookies, and public auth API endpoints.
- **Notification preferences & opt-out** — member-level channel preferences with opt-out check before send, device token registration for push.
- **Twilio SMS provider** — REST API integration with configurable API base URL.
- **OneSignal push provider** — REST API integration with configurable API base URL.
- **Notification test-send** — admin endpoint with memberId/recipient overrides, template preview with real member context.
- **Idempotency-key support** — on points accumulate, redeem, and adjust operations.
- **Audit trail** — discriminator-based actor tracking (API_KEY, MEMBER, ADMIN) for all admin operations.
- **CHANGELOG** — this file.

### Changed

- Widget refactored to support mini/full display modes per spec, sub-50 KB bundle.
- Auth plugin encapsulated via `fastify-plugin` for correct hook firing on all routes.
- Template variable context now includes `balance` alongside `points` for parity between triggers and test-send.

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

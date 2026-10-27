# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Personal access tokens (PATs).** Admins mint `lopat_` bearer tokens from the
  admin UI (_API tokens_) or the CLI (`admin:token:create` / `admin:token:list` /
  `admin:token:revoke`). A token is shown exactly once, stored only as a SHA-256
  hash, expires within 90 days, and its effective role is always capped by its
  owner's current role. Token-authenticated requests cannot mint, list, or revoke
  tokens, nor edit the owner's profile. (#48)
- **Functional MCP server.** The MCP server authenticates with a personal access
  token (`LOYALTYOS_TOKEN`) instead of an internal API key, and gains the
  `analytics_dashboard` and `analytics_campaign` tools backed by the new
  `GET /admin/stats/dashboard` and `GET /admin/campaigns/:id/stats` endpoints. (#48)

### Security

- **No token material leaks from `/admin/tokens`.** `POST`, `GET`, and `DELETE`
  responses never include `tokenHash`; `DELETE` returns only `{ id, revoked }`
  (idempotent on re-revoke), and a token id owned by another program returns
  `404` rather than `403` so token existence is not disclosed. (#48)

## [1.2.0] - 2026-10-21

### Added

- **Admin roles are enforced across every `/admin/*` route.** Each role — `SUPER_ADMIN`, `OPERATOR`, `ANALYST` — gets a fixed capability set from a single deny-by-default map. Summarized:
  - **ANALYST** — read-only (all `GET`/list/stats/count/estimate/preview), except gift-card code export, plus read-only AI tools.
  - **OPERATOR** — everything `ANALYST` has, plus writes to members, campaigns, coupons (and coupon-code reveal), segments, badges, tiers, rewards, notification templates, and gift-card terms.
  - **SUPER_ADMIN** — everything `OPERATOR` has, plus webhooks, gift-card financial operations and code reveal, coalition, and program settings. (#32)
- **`@loyaltyos/permissions`** — the shared role/permission model consumed by both the API and the admin UI, so the two cannot drift.
- **AI companion filtered by role** — `ANALYST` is offered read-only tools only; `OPERATOR` and `SUPER_ADMIN` see the full set.
- **`admin:create` CLI** — provision an admin with a role (`pnpm --filter @loyaltyos/api admin:create --email --role --program`).
- **Audit log records denied requests** as `ACCESS_DENIED`, capturing the role, method, and route.

### Security

- **Gift card codes are only revealed to `SUPER_ADMIN`.** `OPERATOR`/`ANALYST` see the last four characters only (server-side masking) and cannot export batch codes; the export route now requires the `giftcards.codes.reveal` permission.
- **Coupon codes are masked for `ANALYST`.** `SUPER_ADMIN` and `OPERATOR` see full codes (`coupons.codes.reveal`); `ANALYST` sees only the last four characters in the list, detail, and stats endpoints.
- **Coalition credentials are write-only.** `GET` and `PUT /admin/coalition/config` no longer return `encryptedCredentials`; they return `hasCredentials` instead.
- **Admin routes no longer trust `X-Program-Id`.** The program is always taken from the authenticated session or API key, removing the header-based tenant-switch fallback.

### Changed

- The seed now creates `operator@loyaltyos.dev` (OPERATOR) and `analyst@loyaltyos.dev` (ANALYST) alongside the super admin.

### Breaking changes

- **Admin permissions are enforced by role.** Admins that are not `SUPER_ADMIN` lose access to gift-card financial operations, batch code export, coalition, program settings, and webhooks.
- ANALYST sessions are read-only on non-admin routes too (e.g. `POST /events`, `POST /members` return 403).
- Coupon codes are masked for ANALYST.

### Upgrade notes

> ⚠️ **Review every admin's role before upgrading.** The default role is `OPERATOR`: admins who are not `SUPER_ADMIN` lose access to gift-card financial operations, code export, coalition, program settings and webhooks.

```sql
-- list admins and their roles
SELECT id, email, role FROM "AdminUser" ORDER BY role, email;
-- promote an admin
UPDATE "AdminUser" SET role = 'SUPER_ADMIN' WHERE email = 'admin@example.com';
```

Alternatively, create a new admin with a role: `pnpm --filter @loyaltyos/api admin:create --email <email> --role SUPER_ADMIN --program <programId>`.

Upgrading from v1.0.x? Apply the v1.1.0 upgrade notes first (security release, GHSA-98hf-vcvp-p8j6).

### Known limitations

- Points ledger concurrency fixes from #29 are not included in this release.

## [1.1.0] - 2026-10-18

> **Security release.** All deployments of v1.0.x should upgrade. See advisory GHSA-98hf-vcvp-p8j6.

### Security

- **Admin routes now require an admin session (deny-by-default).** API keys — including SERVER-scope keys — no longer grant access to `/admin/*`.
- **API keys can no longer switch tenants** via `X-Program-Id`; a mismatched header returns 403.
- **Admin UI authenticates with the session cookie only.** Earlier builds embedded an API key (`dev-key`, SERVER-scope in the seed) in the public admin bundle.
- **Production boot guard:** the API refuses to start while the seeded `dev-key` is active.
- **`/metrics` is token-gated** via `METRICS_TOKEN`.
- **AI companion tools run with the operator's admin session**, not a shared API key.
- **Member actions are recorded as `MEMBER`** (previously `ADMIN_USER`) in the audit log.

### Added

- **Admin AI Companion** (off by default, `AI_COMPANION_ENABLED`): read-only tools run directly; any mutating tool requires a server-side, single-use confirmation.
- **Gift cards:** batch generation, redemption, terms templates, admin UI, CSV/XLSX export.
- **i18n:** admin (es-MX/en-US), portal, widget, API errors and notifications.

### Fixed

- **The API Docker image now boots.** Images published for v1.0.x built but failed at startup.
- **Member magic-link login** no longer returns 500.
- **Admin session persists across page reloads.**
- Docker builds for admin and portal (missing workspace dependencies).

### Changed

- API is bundled with esbuild; base image `node:22-alpine`; CI on Node 22 (Node 20 is EOL).

### Breaking changes

- API keys no longer access `/admin/*`.
- `X-Program-Id` different from the key's program → 403.
- `/metrics` requires `METRICS_TOKEN` (returns 404 in production when unset).
- `GIFTCARD_HMAC_SECRET` is required in production.
- `VITE_API_KEY` and `VITE_PROGRAM_ID` were removed from the admin build.

### Upgrade notes

1. Run database migrations (`prisma migrate deploy`): adds `MEMBER` to `AuditActorType`.
2. Set `GIFTCARD_HMAC_SECRET` and (to scrape metrics) `METRICS_TOKEN`; configure Prometheus to send `Authorization: Bearer <METRICS_TOKEN>`.
3. Deactivate or rotate the `dev-key` API key if it exists, and rotate any key that was used in an admin build.
4. Rebuild the admin UI without `VITE_API_KEY` / `VITE_PROGRAM_ID`.
5. Review the audit log for `/admin/*` actions performed by `API_KEY` actors (see the advisory).

### Known limitations

- **MCP server:** its admin tools call routes that do not exist in the API and do not work in this release (#48).
- Points ledger concurrency fixes from #29 are not included in this release.

## [1.0.0] - 2026-05-21 — Initial Public Release

### Core Platform

- **Points Engine** — immutable ledger with accumulate, redeem, expire, adjust, and reverse operations. Idempotency-key support for safe retries. Rule-based multipliers, pending/confirmed balance tracking, configurable expiry.
- **Multi-Tenant** — program-scoped data isolation enforced at the API layer via `X-API-Key` + `X-Program-Id` headers.
- **REST API** — Fastify 4 + Zod validation + Swagger docs. Rate limiting, CORS, Helmet security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy). 50+ endpoints across stats, members, campaigns, coupons, segments, badges, tiers, rewards, auth, notifications, and coalition.
- **Admin Dashboard** — React 18 + Vite + shadcn/ui + TanStack Query. KPI cards, member management, campaign builder (6-step wizard), segment builder (visual rule editor), coupon generator, badges/tiers editor, rewards catalog, and coalition configuration.
- **Magic-Link Auth** — passwordless login via email (Resend). No passwords stored or transmitted. Session cookies with httpOnly, secure, sameSite strict.
- **Security** — Zod validation on every boundary, per-endpoint rate limiting (auth: 5/min, accumulate: 30/min, redeem: 20/min), CORS whitelist, Helmet defaults, HMAC-SHA256 webhook signing with 5-min timestamp tolerance, Handlebars sandbox with prototype stripping, AES-256-GCM credential encryption.

### Engagement

- **Campaigns** — 8 types (Bonus Points, Spend & Get, Frequency, Milestone, Referral, Birthday, Anniversary, Flash Sale, Tier Upgrade Bonus). Budget capping, stacking rules, A/B testing via CampaignVariant records, impact estimation.
- **Coupons** — 6 discount types (Percentage, Fixed, Free Product, Free Shipping, Extra Points, Experience), 3 modes (Shared, Individual, Limited), bulk generation, usage tracking.
- **Segments** — dynamic rule DSL with AND/OR groups and operators (eq, neq, gt, gte, lt, lte, between, contains, in), static lists, visual builder, real-time member count estimation.
- **Notifications** — multi-channel (Email, SMS, Push, In-App, Webhook), Handlebars templates with sandboxed rendering, provider abstraction (Resend, Twilio, OneSignal), opt-out per channel per member, webhook signing.

### Gamification

- **Badges** — 5 types (Achievement, Status, Temporal, Collectible, Social) with condition DSL, temporal operators (`count_in_window`, `within`, `since`), progress tracking (0-100%), event-driven auto-evaluation.
- **Tiers** — configurable rank hierarchy with threshold-based upgrades, inactivity downgrade job, progress-to-next-tier tracking, tier benefits, pyramid visualization.
- **Rewards** — 6 categories (Discount, Physical Product, Gift Card, Experience, Charity, Coalition Transfer), eligibility checks, stock management, idempotent redemption.
- **Customer Portal** — React PWA with magic-link auth, i18n (en/es), rewards catalog with wishlist, badges gallery with progress, transaction history, notification preferences.
- **Loyalty Widget** — embeddable Lit Web Component, mini/full modes, themeable via CSS custom properties, standalone sub-components, ~45 KB gzipped.

### Coalition

- **Generic Adapter Interface** — pluggable provider implementations with capability flags (accumulate, redeem, convert, reverseTransaction, historyQuery).
- **Apprecio Adapter** — full implementation against real API. MD5 form-data authentication, multi-country (MX, CL, PE, CO, EC), email/RUT identifier types, private token sanitization.
- **Two-Phase Commit** — PENDING → CONFIRMED/FAILED for all external operations. Compensation reversal on core failure.
- **Circuit Breaker** — opossum-based, opens after 5 consecutive failures within 10s, half-open after 30s, auto-closes after 3 successes.
- **Retry Logic** — exponential backoff (1s, 2s, 4s, max 3 attempts) for transient errors. Business errors never retried.
- **Credential Encryption** — AES-256-GCM at rest with KMS_MASTER_KEY support.
- **Admin Panel** — config page, transactions with detail timeline, linked members management, manual reconciliation.

### Security

- **Admin Auth (argon2id)** — Admin login replaced Lucia with direct argon2id password hashing (memory 19456 KiB, time 2, parallelism 1). Session tokens are opaque random values with expiry, stored in a dedicated `AdminSession` table.
- **Login Timing Equalization** — Invalid-email and wrong-password paths run the same argon2 verification (against a dummy hash when the email doesn't exist), preventing email enumeration via response latency.
- **Dependency Audit** — Full `pnpm audit --prod` reviewed. Fastify 4.x vulnerabilities documented with compensating controls (Zod validation, no sendWebStream usage). Docusaurus build-time issues tracked upstream.

### Production

- **Helm Chart** — 33 K8s resources with sub-charts (Bitnami PostgreSQL 16, Redis 7), HPA v2 (CPU + memory), Ingress (nginx + cert-manager), migrations Job (Helm hook), ServiceMonitor for Prometheus, PDB, NetworkPolicy, External Secrets Operator support. Auto-published to GitHub Pages via `chart-releaser-action`.
- **Observability** — OpenTelemetry tracing (HTTP, PostgreSQL, Redis auto-instrumentation), Prometheus metrics (HTTP RPS/latency/errors, BullMQ queue depth/duration/throughput, Node.js defaults), Grafana dashboards (API Overview, BullMQ Queues, Business Metrics).
- **Business KPIs** — 13 `loyaltyos_*` Prometheus metrics: points earned/redeemed/reversed/adjusted/expired, balance gauge, insufficient balance counter, coupons redeemed/created/discount histogram, coalition operations (by provider), circuit breaker state, and active members gauge. Wired via adapter pattern into PointsService, CouponsService, and CoalitionService.
- **Active Members Job** — Hourly scheduled job queries `lastActiveAt` (new column on Member) to set `loyaltyos_active_members_total` per program.
- **Standalone Worker** — BullMQ worker entry point for independent K8s scaling.
- **Docker Compose** — production stack with Prometheus + Grafana + OTEL Collector via `--profile monitoring`.
- **npm Package** — `@loyaltyos/widget` published to npm on every `v*` release. Lit Web Component with IIFE + ESM outputs (~45 KB gzipped).
- **CI/CD** — GitHub Actions: CI (build, typecheck, lint, test with PostgreSQL 14/15/16 matrix + Redis, Codecov upload), Docker (build + push to GHCR with `latest` tag for stable releases), Docs (Docusaurus deploy to GitHub Pages), Release (Helm publish to gh-pages, npm widget publish, GitHub Release with changelog), CodeQL (weekly + on PR), Smoke Test (Docker Compose health checks), Dependabot (npm weekly, Docker monthly, Actions weekly), CODEOWNERS, issue templates (bug/feature), PR template.
- **Documentation** — 27-page Docusaurus site across 7 sections. Custom logo and branding.

### Changed

- All package versions bumped from 0.1.0 to 1.0.0.
- README updated with deployment options, coalition spotlight, future roadmap, contributors/backers sections.
- Roadmap marked complete for all 5 phases.
- Security pass: dependency audit, security headers, rate limits, CORS lockdown, webhook timestamp validation, SECURITY.md.

## [0.4.0] - 2026-05-21

### Added

- **Coalition adapter (`packages/coalition`)** — generic adapter interface with pluggable provider implementations, optional capabilities flags (accumulate, redeem, convert, reverseTransaction, historyQuery), and two-phase commit pattern (PENDING → CONFIRMED/FAILED) for all external operations.
- **Apprecio adapter** — full implementation against the real Apprecio API with MD5 form-data authentication, multi-country base URLs (MX, CL, PE, CO, AR), email/RUT identifier types, private token sanitization in error messages, and configurable timeouts.
- **Coalition API endpoints** — member-facing routes for accumulate, redeem, convert, and reverse with Zod validation and idempotency-key support. Admin routes for config management (GET/PUT), healthcheck, link/unlink accounts, list transactions with filters, list linked accounts, and manual reconciliation.
- **Redis caching** — `getCachedExternalBalance` wrapper with 60s TTL and graceful degradation when Redis is unavailable.
- **Credential encryption** — AES-256-GCM encryption for coalition provider credentials stored in the database, with KMS_MASTER_KEY support and dev fallback.
- **Circuit breaker** — opossum-based circuit breaker per adapter: opens after 5 consecutive failures within 10s, half-open after 30s, auto-closes after 3 consecutive successes.
- **Retry logic** — exponential backoff (1s, 2s, 4s, max 3 attempts) for transient errors; business errors are never retried.
- **Error classification** — dedicated error types with HTTP status mappings: CoalitionConfigNotFoundError (404), CoalitionAccountNotLinkedError (404), CoalitionBusinessError (422), CoalitionTransientError (502), CoalitionCircuitOpenError (503), CoalitionUnsupportedError (501).
- **Coalition admin UI** — config page with provider selector, Apprecio-aware form (country dropdown, public/private tokens with reveal toggle, identifier type, timeouts), feature toggles with capability-based disabling, capabilities banner, test connection button, and save. Transactions page with status/type/member filters, paginated table, detail panel with timeline (PENDING → CONFIRMED/FAILED/REVERSED), and force reverse dialog. Linked members page with search, paginated table, and unlink confirmation dialog.
- **Documentation** — `docs/coalition-apprecio.md` with overview, auth scheme, action mapping, supported flows, configuration, limitations, sandbox checklist, and troubleshooting.

### Changed

- Admin sidebar now includes Coalition link for navigation to coalition configuration, transactions, and linked members pages.
- API error handler extended with 6 coalition error → HTTP status mappings.

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

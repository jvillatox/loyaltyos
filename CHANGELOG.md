# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

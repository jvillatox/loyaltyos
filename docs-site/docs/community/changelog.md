---
sidebar_position: 1
title: Changelog
---

# Changelog

All notable changes to LoyaltyOS. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-05-21

### Added

- **Coalition adapter** — generic adapter interface with pluggable provider implementations, two-phase commit, circuit breaker, retry logic
- **Apprecio adapter** — full implementation against the real Apprecio API with MD5 form-data authentication, multi-country base URLs (MX, CL, PE, CO, AR)
- **Coalition API endpoints** — member-facing routes (accumulate, redeem, convert, reverse) and admin routes (config, link, transactions, reconciliation)
- **Credential encryption** — AES-256-GCM encryption for coalition credentials, KMS_MASTER_KEY support
- **Coalition admin UI** — config page, transactions list with detail panel, linked members management
- **Badges engine** — 5 badge types with condition DSL, progress tracking, event-driven auto-evaluation
- **Tiers engine** — configurable rank hierarchy with threshold-based upgrades, inactivity downgrade
- **Rewards engine** — 6 categories, eligibility checks, stock management, idempotent redemption
- **Customer Portal** — React PWA with magic-link auth, i18n (en/es), rewards catalog, badges gallery, PWA manifest
- **Loyalty Widget** — Lit Web Components, mini/full modes, themeable via CSS custom properties
- **Magic-link auth** — passwordless login via email magic links (Resend)

## [0.2.0] - 2026-05-16

### Added

- **Campaigns engine** — 8 campaign types, budget capping, stacking rules, A/B testing, impact estimation
- **Coupons engine** — 6 discount types, 3 modes, bulk generation, usage tracking
- **Segments engine** — dynamic rule DSL with AND/OR groups, visual segment builder
- **Notifications** — multi-channel delivery (Email, SMS, Push, In-App, Webhook), Handlebars templates
- **Campaign Builder UI** — 6-step wizard with impact estimation card
- **Segment Builder UI** — visual rule builder with condition rows and real-time estimation
- **13 new shadcn/ui components** — Accordion, AlertDialog, Calendar, Checkbox, Command, DropdownMenu, etc.

## [0.1.0] - 2026-05-15

### Added

- **Monorepo scaffold** — Turborepo + pnpm workspaces with TypeScript strict, ESLint, Prettier, Husky, commitlint
- **Database schema** — Prisma ORM with full multi-tenant data model
- **Docker Compose** — local dev infrastructure with PostgreSQL 15, Redis 7, MailHog, Adminer
- **Points engine** — accumulate, redeem, expire, adjust, reverse with idempotency-key support
- **REST API** — Fastify 5 with Zod validation, API key auth, rate limiting, CORS, Swagger docs
- **Admin UI** — React 18 + Vite + shadcn/ui + TanStack Query, dashboard, member management
- **Seed script** — demo program with 12 members, 3 tiers, 2 campaigns, 2 coupons, 3 rewards, 2 badges

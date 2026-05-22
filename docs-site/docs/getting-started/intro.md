---
sidebar_position: 1
title: Introduction
---

# Introduction

**LoyaltyOS** is the only open source loyalty platform with **native coalition support** — run your own points program while connecting to external coalition networks like Puntos Apprecio. MIT licensed.

Most loyalty platforms lock you into a single points ecosystem. LoyaltyOS lets you run **dual points programs**: your own proprietary points alongside external coalition points (like Puntos Apprecio across Mexico, Chile, Colombia, Peru, and Ecuador). The coalition adapter is pluggable — swap Apprecio for any provider by implementing a single interface.

## Features

- **Points Engine** — immutable ledger with earn, redeem, expire, and adjust operations. Idempotency-key support for safe retries.
- **Multi-tenant** — multiple programs under a single installation, scoped via API key + program ID headers.
- **Admin Dashboard** — React UI with KPI cards, member management, point balance, and transaction history.
- **REST API** — Fastify-based with Zod validation, Swagger docs, rate limiting, and CORS.
- **Tiers & Badges** — 5 badge types with condition DSL, rank tiers with progress tracking and pyramid visualization.
- **Rewards Catalog** — 6 categories, eligibility checks, stock management, and idempotent redemption.
- **Campaigns** — 8 types with budget capping, stacking rules, A/B testing, and impact estimation.
- **Coupons** — 6 discount types, 3 modes, bulk generation, usage tracking.
- **Segments** — dynamic rule builder with AND/OR conditions (eq, gt, contains, between) and static lists.
- **Notifications** — multi-channel delivery (email, SMS, push, in-app, webhook) with Handlebars templates.
- **Customer Portal** — mobile-first React PWA with magic-link auth, i18n, rewards catalog, badges gallery.
- **Loyalty Widget** — embeddable Lit Web Component with mini/full modes, themeable via CSS custom properties.
- **Coalition Points** — native integration with Apprecio and generic adapters, two-phase commit for safe cross-system earn/redeem/convert, circuit breaker with retry logic, credential encryption at rest.
- **Privacy-first** — soft-delete on members, GDPR-ready data isolation.

## Design Principles

- **API-first** — everything the Admin UI does is available via REST.
- **Immutable ledger** — point transactions are never deleted. Reversals use contra-entries.
- **Idempotent** — critical operations require an `Idempotency-Key` header.
- **Multi-tenant** — program-scoped data isolation enforced at the API layer.
- **Event-driven** — business logic triggers from events (purchase, registration, etc.).
- **Modular** — each subsystem is an independent package that can be enabled or disabled.

## Tech Stack

| Layer     | Technology                                          |
| --------- | --------------------------------------------------- |
| API       | Node.js 20, Fastify 4, TypeScript strict            |
| Database  | PostgreSQL 15, Prisma ORM                           |
| Cache     | Redis 7                                             |
| Admin UI  | React 18, Vite, Tailwind, shadcn/ui, TanStack Query |
| Portal    | React 18, Vite, Tailwind, i18next, PWA              |
| Widget    | Lit 3, Web Components, ~45 KB bundle                |
| Dev Tools | Turborepo, ESLint, Prettier, Husky, commitlint      |
| Testing   | Vitest, Supertest                                   |
| Infra     | Docker Compose, Helm, Prometheus, OpenTelemetry     |

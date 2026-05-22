---
sidebar_position: 2
title: Quick Start
---

# Quick Start

Get LoyaltyOS running locally in under 10 minutes.

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** + Docker Compose

## 1. Clone and install

```bash
git clone https://github.com/jvillatox/loyaltyos.git
cd loyaltyos
pnpm install
```

## 2. Start infrastructure

```bash
docker compose up -d
```

Starts PostgreSQL 15, Redis 7, MailHog (SMTP testing), and Adminer (DB browser at :8080).

## 3. Set up the database

```bash
cp apps/api/.env.example apps/api/.env    # edit if needed
pnpm --filter @loyaltyos/api db:reset     # run migrations
pnpm --filter @loyaltyos/api db:seed      # seed demo data
```

## 4. Start the apps

```bash
pnpm dev
```

| App             | URL                        |
| --------------- | -------------------------- |
| Admin UI        | http://localhost:5173      |
| Customer Portal | http://localhost:5174      |
| REST API        | http://localhost:3002      |
| Swagger         | http://localhost:3002/docs |
| Adminer         | http://localhost:8080      |
| MailHog         | http://localhost:8025      |

## Demo credentials

The seed script creates a demo program with:

- **API Key:** `dev-key`
- **Program ID:** `prog_dev`
- **Admin Email:** `admin@loyaltyos.dev`
- **Admin Password:** `demo1234`

## Sign in to the Admin UI

1. Open [http://localhost:5174](http://localhost:5174) in your browser
2. Enter the demo credentials above
3. You're redirected to the dashboard — all admin endpoints use an httpOnly session cookie (argon2id hashed)

To sign out, click **Sign out** at the bottom of the sidebar.

## Test the API

```bash
# Dashboard stats
curl http://localhost:3002/api/v1/stats/dashboard \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev"

# Paginated member list
curl "http://localhost:3002/api/v1/members?page=1&pageSize=5" \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev"
```

## Project Structure

```
loyaltyos/
├── apps/
│   ├── api/                 # REST API (Fastify + Prisma + Zod)
│   ├── admin/               # Admin UI (React + Vite + shadcn/ui)
│   ├── portal/              # Customer Portal (React PWA + i18n)
│   └── widget/              # Embeddable loyalty widget (Lit Web Components)
├── packages/
│   ├── core/                # Points engine
│   ├── campaigns/           # Campaign rules engine
│   ├── coupons/             # Coupon system
│   ├── segments/            # Dynamic segments DSL
│   ├── notifications/       # Multi-channel notifications
│   ├── badges/              # Badges engine + tiers
│   ├── rewards/             # Reward catalog
│   ├── coalition/           # Coalition adapter
│   └── telemetry/           # Observability (OTel + Prometheus)
├── infra/                   # Docker, Kubernetes, Helm, Grafana
├── docs-site/               # This documentation site
└── docs/                    # Additional technical docs
```

## Commands

| Command                                | Description                    |
| -------------------------------------- | ------------------------------ |
| `pnpm install`                         | Install all dependencies       |
| `pnpm dev`                             | Start all apps in dev mode     |
| `pnpm build`                           | Build all packages and apps    |
| `pnpm test`                            | Run all tests                  |
| `pnpm typecheck`                       | Type-check the entire monorepo |
| `pnpm lint`                            | Lint all packages              |
| `pnpm format`                          | Format code with Prettier      |
| `pnpm --filter @loyaltyos/api db:seed` | Re-seed demo data              |

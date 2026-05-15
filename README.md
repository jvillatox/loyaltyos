# LoyaltyOS

> Open source customer loyalty platform with native coalition support. MIT licensed.

**LoyaltyOS** is a modular, API-first loyalty platform designed to be simple to deploy but powerful in operation. Connect your sales channels, run campaigns, issue coupons, manage tiers and badges, and integrate with coalition point systems (Puntos Apprecio) — all from a single Dockerized stack.

## Features

- **Points Engine** — immutable ledger with earn, redeem, expire, and adjust operations. Idempotency-key support for safe retries.
- **Multi-tenant** — multiple programs under a single installation, scoped via API key + program ID headers.
- **Admin Dashboard** — React UI with KPI cards, member management, point balance, and transaction history.
- **REST API** — Fastify-based with Zod validation, Swagger docs, rate limiting, and CORS.
- **Tiers & Badges** — configurable rank tiers (Silver, Gold, Platinum) and gamification badges.
- **Campaigns** — time-boxed multipliers (bonus points, flash sales) with budget capping.
- **Coupons & Rewards** — percentage/fixed discount coupons and points-based reward catalog.
- **Privacy-first** — soft-delete on members, GDPR-ready data isolation.

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** + Docker Compose

### 1. Clone and install

```bash
git clone https://github.com/jaimevillatoro/loyaltyos.git
cd loyaltyos
pnpm install
```

### 2. Start infrastructure

```bash
docker compose up -d
```

Starts PostgreSQL 15, Redis 7, MailHog (SMTP testing), and Adminer (DB browser at :8080).

### 3. Set up the database

```bash
cp apps/api/.env.example apps/api/.env    # edit if needed
pnpm --filter @loyaltyos/api db:reset     # run migrations
pnpm --filter @loyaltyos/api db:seed      # seed demo data
```

### 4. Start the apps

```bash
pnpm dev
```

| App      | URL                        |
| -------- | -------------------------- |
| Admin UI | http://localhost:5173      |
| REST API | http://localhost:3000      |
| Swagger  | http://localhost:3000/docs |
| Adminer  | http://localhost:8080      |
| MailHog  | http://localhost:8025      |

### Demo credentials

The seed script creates a demo program with:

- **API Key:** `dev-key`
- **Program ID:** `prog_dev`
- **Admin User:** `admin@loyaltyos.dev`

### Test the API

```bash
# Dashboard stats
curl http://localhost:3000/api/v1/stats/dashboard \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev"

# Paginated member list
curl "http://localhost:3000/api/v1/members?page=1&pageSize=5" \
  -H "X-API-Key: dev-key" \
  -H "X-Program-Id: prog_dev"
```

## Project Structure

```
loyaltyos/
├── apps/
│   ├── api/                 # REST API (Fastify + Prisma + Zod)
│   ├── admin/               # Admin UI (React + Vite + shadcn/ui)
│   └── widget/              # Embeddable loyalty widget (planned)
├── packages/
│   ├── core/                # Points engine — accumulate, redeem, expire, adjust
│   └── ...                  # More packages coming in future phases
├── docker-compose.yml       # Local dev infrastructure
├── turbo.json               # Turborepo pipeline
└── docs/
    └── SPEC.md              # Full architecture and roadmap
```

## Tech Stack

| Layer     | Technology                                          |
| --------- | --------------------------------------------------- |
| API       | Node.js 20, Fastify 4, TypeScript strict            |
| Database  | PostgreSQL 15, Prisma ORM                           |
| Cache     | Redis 7                                             |
| Admin UI  | React 18, Vite, Tailwind, shadcn/ui, TanStack Query |
| Charts    | Recharts                                            |
| Dev Tools | Turborepo, ESLint, Prettier, Husky, commitlint      |
| Testing   | Vitest, Supertest                                   |
| Infra     | Docker Compose (Postgres, Redis, MailHog, Adminer)  |

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

## API Overview

All endpoints require `X-API-Key` and `X-Program-Id` headers.

| Method | Endpoint                           | Description                              |
| ------ | ---------------------------------- | ---------------------------------------- |
| `GET`  | `/healthz`                         | Health check                             |
| `GET`  | `/readyz`                          | Readiness probe (DB check)               |
| `GET`  | `/api/v1/stats/dashboard`          | KPI aggregates                           |
| `GET`  | `/api/v1/members`                  | List members (paginated)                 |
| `POST` | `/api/v1/members`                  | Create a member                          |
| `GET`  | `/api/v1/members/:id`              | Get member by ID                         |
| `GET`  | `/api/v1/members/:id/balance`      | Get member point balance                 |
| `GET`  | `/api/v1/members/:id/transactions` | Get member transaction history           |
| `POST` | `/api/v1/members/:id/adjust`       | Adjust points (requires Idempotency-Key) |
| `POST` | `/api/v1/events`                   | Ingest an event                          |

Full OpenAPI spec at `/docs` when the API is running.

## Design Principles

- **API-first** — everything the Admin UI does is available via REST.
- **Immutable ledger** — point transactions are never deleted. Reversals use contra-entries.
- **Idempotent** — critical operations require an `Idempotency-Key` header.
- **Multi-tenant** — program-scoped data isolation enforced at the API layer.
- **Event-driven** — business logic triggers from events (purchase, registration, etc.).
- **Modular** — each subsystem is an independent package that can be enabled or disabled.

## Roadmap

| Phase | Scope                                                          | Status      |
| ----- | -------------------------------------------------------------- | ----------- |
| 1     | Core MVP — monorepo, points engine, REST API, Admin UI, Docker | In progress |
| 2     | Engagement — campaigns, coupons, notifications, segments       | Planned     |
| 3     | Gamification — badges, tiers, rewards, customer widget         | Planned     |
| 4     | Coalition — Apprecio adapter, coalition accounts, admin panel  | Planned     |
| 5     | Production — Helm charts, OTel, Docusaurus, CI/CD, v1.0.0      | Planned     |

Full details in [docs/SPEC.md](docs/SPEC.md).

## Contributing

Contributions are welcome. This project uses:

- **TypeScript strict** — no `any` without justification.
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **Pre-commit hooks** — Husky runs ESLint, Prettier, and commitlint on staged files.
- **Formatting** — Prettier with single quotes, trailing commas, and 100-char print width.

Before submitting a PR, make sure `pnpm typecheck` and `pnpm lint` pass cleanly.

## License

MIT — see [LICENSE](LICENSE).

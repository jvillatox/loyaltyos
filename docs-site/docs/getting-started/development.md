---
sidebar_position: 3
title: Development Guide
---

# Development Guide

How to set up and contribute to LoyaltyOS development.

## Requirements

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** + Docker Compose

## First Time Setup

```bash
git clone https://github.com/jvillatox/loyaltyos.git
cd loyaltyos

# Copy environment file
cp .env.example .env

# Start infrastructure
docker compose up -d

# Install dependencies
pnpm install

# Create and seed the database
pnpm --filter @loyaltyos/api db:reset
pnpm --filter @loyaltyos/api db:seed

# Start dev servers
pnpm dev
```

## Common Commands

| Command                                   | Description                    |
| ----------------------------------------- | ------------------------------ |
| `pnpm install`                            | Install all dependencies       |
| `pnpm dev`                                | Start all apps in dev mode     |
| `pnpm build`                              | Build all packages and apps    |
| `pnpm test`                               | Run all tests                  |
| `pnpm typecheck`                          | Type-check the entire monorepo |
| `pnpm lint`                               | Lint all packages              |
| `pnpm format`                             | Format code with Prettier      |
| `pnpm --filter @loyaltyos/api db:reset`   | Drop and recreate database     |
| `pnpm --filter @loyaltyos/api db:seed`    | Seed demo data                 |
| `pnpm --filter @loyaltyos/api db:studio`  | Open Prisma Studio             |
| `pnpm --filter @loyaltyos/api db:migrate` | Create a new migration         |

## Conventions

- **TypeScript strict** — no `any` without justification.
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **Pre-commit hooks** — Husky runs ESLint, Prettier, and commitlint on staged files.
- **Formatting** — Prettier with single quotes, trailing commas, and 100-char print width.
- **API validation** — every endpoint is validated with Zod.
- **Idempotency** — Idempotency-Key header on accumulate, redeem, and convert operations.

## Package Layout

```
packages/<module>/
├── src/
│   ├── index.ts        # public exports
│   ├── service.ts      # business logic
│   ├── repository.ts   # data access
│   ├── types.ts
│   └── __tests__/
├── package.json
└── README.md
```

## Troubleshooting

### Ports already in use

```bash
lsof -i :5432
lsof -i :6379
docker ps --filter "publish=5432"
docker stop <container-id>
```

### Reset everything

```bash
docker compose down -v
docker compose up -d
pnpm --filter @loyaltyos/api db:reset
pnpm --filter @loyaltyos/api db:seed
```

### Database connection errors

```bash
docker compose ps postgres
# Should show "healthy" status

pnpm --filter @loyaltyos/api exec prisma migrate status
```

### Prisma migration conflicts

Never edit a migration that has already been applied. Create a new one:

```bash
pnpm --filter @loyaltyos/api exec prisma migrate dev --name fix_description
```

# Development Guide

## Requirements

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** + Docker Compose

## First Time Setup

```bash
# 1. Clone the repo
git clone https://github.com/jvillatox/loyaltyos.git
cd loyaltyos

# 2. Copy environment file
cp .env.example .env
# Edit .env with your secrets if needed (defaults work for local dev)

# 3. Start infrastructure
docker compose up -d

# 4. Install dependencies
pnpm install

# 5. Create and seed the database
pnpm --filter api db:reset
pnpm --filter api db:seed

# 6. Start dev servers
pnpm dev
```

API: http://localhost:3000
Admin UI: http://localhost:5173
API Docs (Swagger): http://localhost:3000/docs
Adminer (DB UI): http://localhost:8080
MailHog (email capture): http://localhost:8025

## Common Commands

| Command                                         | Description                              |
| ----------------------------------------------- | ---------------------------------------- |
| `pnpm install`                                  | Install all dependencies                 |
| `pnpm dev`                                      | Start all apps in dev mode (API + Admin) |
| `pnpm build`                                    | Build all packages and apps              |
| `pnpm test`                                     | Run all tests                            |
| `pnpm typecheck`                                | Type-check the entire monorepo           |
| `pnpm lint`                                     | Lint all packages                        |
| `pnpm format`                                   | Format code with Prettier                |
| `pnpm --filter api db:reset`                    | Drop and recreate database               |
| `pnpm --filter api db:seed`                     | Seed demo data                           |
| `pnpm --filter api db:studio`                   | Open Prisma Studio                       |
| `pnpm --filter api db:migrate -- --name <name>` | Create a new migration                   |

## Project Structure

```
loyaltyos/
├── apps/
│   ├── api/              # REST + GraphQL API (Fastify)
│   ├── admin/            # Admin UI (React + Vite)
│   └── widget/           # Embeddable loyalty widget (Web Components)
├── packages/
│   ├── core/             # Points engine
│   ├── campaigns/        # Campaign engine
│   ├── segments/         # Customer segmentation
│   ├── coupons/          # Coupon management
│   ├── rewards/          # Rewards catalog
│   ├── badges/           # Badges and gamification
│   ├── coalition/        # Coalition connector
│   └── notifications/    # Notification channels
├── infra/                # Docker, Kubernetes
├── docs/                 # Documentation
│   ├── SPEC.md           # Full project spec
│   ├── data-model.md     # Database schema reference
│   └── development.md    # This file
├── docker-compose.yml    # Local dev infrastructure
├── turbo.json            # Turborepo config
└── tsconfig.base.json    # Shared TypeScript config
```

## Troubleshooting

### Ports already in use

```bash
# Check what's using the port
lsof -i :5432
lsof -i :6379
# Stop conflicting containers
docker ps --filter "publish=5432"
docker stop <container-id>
```

### Reset everything

```bash
docker compose down -v    # Removes volumes (deletes all data)
docker compose up -d      # Fresh start
pnpm --filter api db:reset
pnpm --filter api db:seed
```

### Database connection errors

```bash
# Check if Postgres is running
docker compose ps postgres
# Should show "healthy" status

# Test connection
pnpm --filter api exec prisma migrate status
```

### Prisma migration conflicts

Never edit a migration that has already been applied. Create a new one:

```bash
pnpm --filter api exec prisma migrate dev --name fix_description
```

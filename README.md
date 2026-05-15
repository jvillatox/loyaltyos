# LoyaltyOS

> Open source customer loyalty platform with native points-coalition support (Puntos Apprecio).

A modular, API-first loyalty platform designed to be simple to deploy but powerful in operation. Connect your sales channels, run campaigns, issue coupons, manage tiers and badges, and integrate with coalition point systems — all from a single Dockerized stack.

## Requirements

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** + Docker Compose

## Quick Start

```bash
docker compose up -d          # PostgreSQL, Redis, MailHog, Adminer
pnpm install                   # Install all dependencies
pnpm --filter api db:reset     # Create/reset database
pnpm --filter api db:seed      # Seed demo data
pnpm dev                       # Start API (port 3000) + Admin (port 5173)
```

Open http://localhost:5173 in your browser to access the Admin UI.  
API docs available at http://localhost:3000/docs.

## Commands

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `pnpm install`   | Install all dependencies       |
| `pnpm dev`       | Start all apps in dev mode     |
| `pnpm build`     | Build all packages and apps    |
| `pnpm test`      | Run all tests                  |
| `pnpm typecheck` | Type-check the entire monorepo |
| `pnpm lint`      | Lint all packages              |
| `pnpm format`    | Format code with Prettier      |

## Project Structure

```
loyaltyos/
├── apps/
│   ├── api/              # REST + GraphQL API (Node.js / Fastify)
│   ├── admin/            # Admin UI (React + Vite)
│   └── widget/           # Embeddable loyalty widget (Web Components)
├── packages/
│   ├── core/             # Points engine and business rules
│   ├── campaigns/        # Campaign engine
│   ├── segments/         # Customer segmentation
│   ├── coupons/          # Coupon management
│   ├── rewards/          # Rewards catalog
│   ├── badges/           # Badges and gamification
│   ├── coalition/        # Coalition connector (Apprecio + generic)
│   ├── notifications/    # Notification channels (email, SMS, push)
│   ├── config-eslint/    # Shared ESLint configuration
│   └── config-prettier/  # Shared Prettier configuration
├── infra/                # Docker, Kubernetes
└── docs/                 # Documentation
```

## Documentation

- [Full Project Spec](docs/SPEC.md) — Architecture, modules, and roadmap
- More docs coming as the project progresses.

## License

MIT — see [LICENSE](LICENSE).

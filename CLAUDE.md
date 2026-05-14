# LoyaltyOS — Project Memory for Claude Code

## What this is
Open source customer loyalty platform. MIT-licensed. Monorepo (Turborepo).

## Stack
- API: Node.js 20 + Fastify + Prisma + PostgreSQL 15 + Redis 7 + BullMQ
- Admin UI: React 18 + Vite + TanStack Query + shadcn/ui + Tailwind
- Widget: Lit (Web Components)
- Auth: Lucia
- Tests: Vitest + Supertest
- TypeScript strict everywhere

## Conventions
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- All comments and docs in English. Conversation with Jaime in Spanish.
- Validate every endpoint with Zod.
- Idempotency-Key header on critical operations (accumulate/redeem/convert).
- Points ledger is immutable — reverse with contra-entries, never delete.
- Nothing business-related is hardcoded. Use env vars or a config table.
- Each `packages/*` ships its own README.md.

## Source of truth
The full project spec lives at `docs/SPEC.md`. Read it before any architectural decision.

## Per-package layout
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

## Roadmap phases
1. Core MVP — monorepo, schema, points engine, REST API, Admin dashboard, Docker Compose.
2. Engagement — campaigns, coupons, notifications, segments.
3. Gamification — badges, tiers, rewards, customer portal/widget.
4. Coalition — CoalitionAdapter + ApprecioAdapter + admin panel.
5. Production — Helm, OTel, Docusaurus, GitHub Actions, v1.0.0.

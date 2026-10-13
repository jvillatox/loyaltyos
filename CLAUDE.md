# LoyaltyOS — Project Memory for Claude Code

## What this is

Open source customer loyalty platform. MIT-licensed. Monorepo (Turborepo).

## Stack

- API: Node.js 22 + Fastify + Prisma + PostgreSQL 15 + Redis 7 + BullMQ
  (bundled with esbuild into `apps/api/dist/index.js`; base image `node:22-alpine`)
- Admin UI: React 18 + Vite + TanStack Query + shadcn/ui + Tailwind
- Widget: Lit (Web Components)
- Auth: Lucia
- Tests: Vitest + Supertest
- TypeScript strict everywhere

## Build & runtime

- The API is bundled with esbuild into `apps/api/dist/index.js` (`build.mjs`).
  `@loyaltyos/*` workspace packages are inlined; third-party deps stay external.
- `--config.shamefully-hoist=true` lives ONLY in `apps/api/Dockerfile` — there is no
  root `.npmrc`. It exists so the externalized transitive deps (prom-client, opossum,
  i18next) resolve at runtime.
- Base image `node:22-alpine` + `apk add openssl` (Prisma query engine needs `libssl.so.3`).
- Prisma `binaryTargets` includes `linux-musl-arm64-openssl-3.0.x` so the arm64 image
  boots natively (no `--platform`).

## Security

- `/metrics` requires a Bearer `METRICS_TOKEN` in production: hidden (404) if empty,
  401 on a bad token, open in development.
- `GIFTCARD_HMAC_SECRET` is required in production — the API refuses to boot if it is
  empty or set to `dev-secret`.
- AI companion tools are read-only by default (`READ_ONLY_TOOLS` whitelist); any mutation
  requires a server-owned confirmation stored in Redis (keyed by toolCallId, scoped to
  admin + program, 10-min TTL, consumed with `GETDEL`).

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

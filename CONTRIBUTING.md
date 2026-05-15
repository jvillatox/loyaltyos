# Contributing to LoyaltyOS

Thanks for your interest in contributing. LoyaltyOS is an open source customer loyalty platform, and we welcome contributions of all kinds — code, docs, bug reports, and feature ideas.

This document will be expanded as the project matures. For Phase 1, here's how to get started.

## Getting started

1. **Fork** the repo and clone it locally.
2. Install dependencies: `pnpm install`
3. Start infrastructure: `docker compose up -d`
4. Set up the database: `pnpm --filter @loyaltyos/api db:reset && pnpm --filter @loyaltyos/api db:seed`
5. Start dev mode: `pnpm dev`

## Conventions

This project enforces strict standards via automation. Before pushing, make sure your code passes:

```bash
pnpm typecheck    # TypeScript strict mode — no implicit any
pnpm lint         # ESLint + Prettier
pnpm test         # Vitest (unit + integration)
```

### Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `refactor:` — code restructuring without behavior change
- `test:` — test additions or changes
- `chore:` — tooling, dependencies, config

Pre-commit hooks (Husky) run lint-staged and commitlint on your changes automatically.

### TypeScript

- Strict mode everywhere. Do not disable `strict` in tsconfig.
- No `any` without explicit justification (and an ESLint disable comment).
- No `@ts-ignore` — use `@ts-expect-error` with a comment explaining why.

### Code style

- Prettier with single quotes, trailing commas, and 100-char print width.
- All comments and documentation in English.
- Each `packages/*` ships its own README.md with public API examples.

## Project structure

```
loyaltyos/
├── apps/
│   ├── api/          # REST API (Fastify + Prisma + Zod)
│   ├── admin/        # Admin UI (React + Vite + shadcn/ui)
│   └── widget/       # Embeddable loyalty widget
├── packages/
│   ├── core/         # Points engine — accumulate, redeem, expire, adjust
│   └── ...           # More packages coming in future phases
├── docs/             # Architecture, data model, development guide
└── docker-compose.yml
```

## Pull request checklist

- [ ] TypeScript typechecks: `pnpm typecheck`
- [ ] Lint passes: `pnpm lint`
- [ ] Tests pass: `pnpm test`
- [ ] New features include tests
- [ ] API changes are reflected in the OpenAPI spec (auto-generated via Zod)
- [ ] Commit messages follow Conventional Commits

## Reporting bugs

Open an issue on GitHub. Include:

1. Steps to reproduce
2. Expected vs actual behavior
3. Environment: OS, Node version, Docker version
4. Relevant logs or screenshots

## Feature requests

Open an issue with the `enhancement` label. Describe the use case and the problem it solves.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

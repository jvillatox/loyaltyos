---
sidebar_position: 2
title: Contributing
---

# Contributing to LoyaltyOS

Thanks for your interest in contributing. LoyaltyOS is MIT-licensed and welcomes contributions of all kinds.

## Getting Started

1. **Fork** the repo and clone it locally.
2. Install dependencies: `pnpm install`
3. Start infrastructure: `docker compose up -d`
4. Set up the database: `pnpm --filter @loyaltyos/api db:reset && pnpm --filter @loyaltyos/api db:seed`
5. Start dev mode: `pnpm dev`

## Conventions

Before pushing, make sure your code passes:

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
- No `any` without explicit justification.
- No `@ts-ignore` — use `@ts-expect-error` with a comment explaining why.

### Code Style

- Prettier with single quotes, trailing commas, and 100-char print width.
- All comments and documentation in English.
- Each `packages/*` ships its own README.md with public API examples.

## Pull Request Checklist

- [ ] TypeScript typechecks: `pnpm typecheck`
- [ ] Lint passes: `pnpm lint`
- [ ] Tests pass: `pnpm test`
- [ ] New features include tests
- [ ] API changes are reflected in the OpenAPI spec
- [ ] Commit messages follow Conventional Commits

## Reporting Bugs

Open an issue on GitHub. Include:

1. Steps to reproduce
2. Expected vs actual behavior
3. Environment: OS, Node version, Docker version
4. Relevant logs or screenshots

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

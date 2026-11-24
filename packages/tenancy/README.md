# @loyaltyos/tenancy

Request/job-scoped tenant context and the transaction-aware Prisma extension for
multi-tenant row-level security (see `docs/design/tenancy.md` §2).

## What it provides

- `TenantContext` (`{ organizationId, programId? }`) carried through
  `AsyncLocalStorage`, with `runWithTenant(ctx, fn)`, `getTenant()`, and
  `requireTenant()`.
- `createTenantPrismaClient(base, { mode, onMissingContext })` — wraps a Prisma
  client so every tenant-scoped query applies `set_config('app.organization_id',
…, true)` once per transaction:
  - inside an interactive `$transaction`, `set_config` is issued at the start;
  - a loose query outside a transaction is wrapped as a batch
    `$transaction([set_config, query])`;
  - `$queryRaw` / `$executeRaw` are covered the same way.
- Fail-visible missing context: `TenantContextMissing` under `enforce`, an
  `onMissingContext` callback (log + metric) under `audit`.
- `resolveOrganizationId(db, programId)` — resolves a program's organization via
  the `SECURITY DEFINER` function `app_org_for_program`, with a direct-read
  fallback for `TENANCY_RLS=off`.

## Usage

```ts
import { createTenantPrismaClient, runWithTenant, resolveTenantRlsMode } from "@loyaltyos/tenancy";

const prisma = createTenantPrismaClient(basePrisma, { mode: resolveTenantRlsMode });

// In the auth plugin:
await runWithTenant({ organizationId: "org_1", programId: "prog_a" }, () => handler());
```

The `mode` is resolved lazily per query, so `TENANCY_RLS` can be read once at boot
or per request as needed.

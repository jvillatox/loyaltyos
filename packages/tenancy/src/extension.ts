import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { getTenant } from "./context.js";
import { TenantContextMissing } from "./errors.js";
import type { TenantRlsMode } from "./mode.js";

// Global tables (docs/design/tenancy.md §3.2) read before tenant context exists
// (to establish it) or that are themselves the identity/tenant roots. Queries on
// these are exempt from the missing-context guard.
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([
  "AdminUser",
  "Organization",
  "User",
  "OrganizationMembership",
  "PersonalAccessToken",
  "Session",
  "AdminSession",
  "MagicLinkToken",
  "MemberSessionToken",
  "ApiKey",
]);

export interface TenancyExtensionOptions {
  mode: TenantRlsMode | (() => TenantRlsMode);
  onMissingContext?: (model: string, operation: string) => void;
}

type PrismaTx = Prisma.TransactionClient;

// Set the tenant GUC for the current transaction. `is_local = true` makes it
// `SET LOCAL`-equivalent: it lives only for the transaction and is discarded at
// commit/rollback, which is what makes it safe across a shared connection pool.
const setContext = (organizationId: string) =>
  Prisma.sql`SELECT set_config('app.organization_id', ${organizationId}, true)`;

// Wraps a Prisma client so that every tenant-scoped query carries the current
// tenant context as a transaction-local GUC (docs/design/tenancy.md §2.2):
//
//   * inside an interactive `$transaction`, `set_config` is issued once at the
//     start and every statement inherits it;
//   * a loose query outside any transaction is wrapped as a batch
//     `$transaction([set_config, query])`;
//   * `$queryRaw` / `$executeRaw` are wrapped the same way (they are not covered
//     by `$allModels`).
//
// Missing context is fail-visible: under `enforce` it throws
// `TenantContextMissing`, under `audit` it invokes `onMissingContext`, and global
// tables are always exempt.
export function createTenantPrismaClient<T extends PrismaClient>(
  base: T,
  options: TenancyExtensionOptions,
): T {
  const resolveMode = typeof options.mode === "function" ? options.mode : () => options.mode;

  // Under `off` the extension is a pure pass-through: no set_config, no wrapping,
  // no missing-context guard. This keeps the default deployment behaviorally
  // identical to an un-extended client (and cheap — no extra transaction per query).
  const isActive = () => resolveMode() !== "off";

  function guardMissingContext(model: string, operation: string): void {
    const mode = resolveMode();
    if (mode === "enforce") throw new TenantContextMissing(model);
    if (mode === "audit") options.onMissingContext?.(model, operation);
  }

  function wrapWithContext(queryPromise: Prisma.PrismaPromise<unknown>) {
    const ctx = getTenant();
    // `ctx` is known non-undefined at every call site below, but keep the guard
    // for clarity; the caller only invokes this after checking context.
    if (!ctx) return queryPromise;
    return base
      .$transaction([base.$executeRaw(setContext(ctx.organizationId)), queryPromise])
      .then((results) => results[1]);
  }

  // The extension is applied to the base client; the resulting client is cast back
  // to the base type so callers keep the full PrismaClient surface (overloads and
  // return types) unchanged.
  return base.$extends({
    name: "tenancy-context",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isActive()) return query(args);
          const modelName = String(model);
          if (!getTenant()) {
            if (GLOBAL_MODELS.has(modelName)) return query(args);
            guardMissingContext(modelName, String(operation));
            return query(args);
          }
          return wrapWithContext(query(args));
        },
      },
      async $queryRaw({ args, query }) {
        if (!isActive()) return query(args);
        if (!getTenant()) {
          guardMissingContext("$queryRaw", "$queryRaw");
          return query(args);
        }
        return wrapWithContext(query(args));
      },
      async $executeRaw({ args, query }) {
        if (!isActive()) return query(args);
        if (!getTenant()) {
          guardMissingContext("$executeRaw", "$executeRaw");
          return query(args);
        }
        return wrapWithContext(query(args));
      },
    },
    client: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $transaction(...args: any[]) {
        const run = base.$transaction.bind(base) as (...a: unknown[]) => Promise<unknown>;
        const rest = args as unknown[];
        if (!isActive()) {
          return run(...rest);
        }

        const ctx = getTenant();
        const first = rest[0];
        const second = rest[1];

        // Batch form: `$transaction([...promises])`.
        if (Array.isArray(first)) {
          const queries = first as Prisma.PrismaPromise<unknown>[];
          if (!ctx) return run(queries, second);
          return run([base.$executeRaw(setContext(ctx.organizationId)), ...queries], second);
        }

        // Interactive form: `$transaction(async (tx) => ...)`.
        const fn = first as (tx: PrismaTx) => Promise<unknown>;
        if (!ctx) return run(fn, second);
        return run(async (tx: PrismaTx) => {
          await tx.$executeRaw(setContext(ctx.organizationId));
          return fn(tx);
        }, second);
      },
    },
  }) as unknown as T;
}

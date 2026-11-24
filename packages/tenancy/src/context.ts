import { AsyncLocalStorage } from "node:async_hooks";

// Request/job-scoped tenant context (docs/design/tenancy.md §2.2). Carried through
// the async call chain by AsyncLocalStorage so the Prisma extension can resolve the
// current organization without threading a parameter through every service.
export interface TenantContext {
  organizationId: string;
  programId?: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext | undefined>();

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as Promise<T>).then === "function"
  );
}

// Runs `fn` with `ctx` visible to `getTenant()`/`requireTenant()` for the whole
// (possibly async) duration of the call. When `fn` returns a promise we re-wrap it
// inside the AsyncLocalStorage scope so the context survives until it settles:
// Prisma's `query`-component interceptors fire when the promise is awaited (which
// happens outside `run()`), and would otherwise observe no tenant context.
export function runWithTenant<T>(ctx: TenantContext, fn: () => T | Promise<T>): T | Promise<T> {
  return tenantStorage.run(ctx, () => {
    const result = fn();
    if (!isThenable(result)) return result;
    return Promise.resolve(result);
  });
}

// Returns the current tenant context, or `undefined` outside a `runWithTenant` scope.
export function getTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

// Returns the current tenant context or throws when there is none. Use in code that
// must only run inside an established tenant scope (e.g. worker sweeps).
export function requireTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error("No tenant context in scope — wrap the call in runWithTenant(...)");
  }
  return ctx;
}

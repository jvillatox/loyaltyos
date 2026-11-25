import {
  resolveOrganizationIdCached,
  resolveTenantRlsMode,
  runWithTenant,
} from "@loyaltyos/tenancy";

import { prisma } from "../db.js";

// Establishes tenant context for a programId before running `fn`
// (docs/design/tenancy.md §2.5). Under `off` (the default) this is a no-op so
// pre-context routes keep their exact prior behavior (no extra org lookup). Under
// `audit`/`enforce` it resolves the organization through the cached
// `app_org_for_program` resolver and wraps `fn` in `runWithTenant` so every
// tenant-scoped query inside carries the context.
export async function withProgramContext<T>(programId: string, fn: () => Promise<T>): Promise<T> {
  if (resolveTenantRlsMode() === "off") {
    return fn();
  }

  const organizationId = await resolveOrganizationIdCached(prisma, programId);
  return (await runWithTenant({ organizationId, programId }, fn)) as T;
}

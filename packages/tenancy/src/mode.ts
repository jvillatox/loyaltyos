// Tenancy RLS enforcement mode (docs/design/tenancy.md §4). `off` is the default
// and makes the Prisma extension a no-op for missing context; `audit` logs and
// counts missing-context queries; `enforce` throws TenantContextMissing.
export type TenantRlsMode = "off" | "audit" | "enforce";

export function resolveTenantRlsMode(): TenantRlsMode {
  const raw = process.env.TENANCY_RLS?.trim().toLowerCase();
  return raw === "audit" || raw === "enforce" ? raw : "off";
}

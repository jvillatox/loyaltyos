// Thrown by the Prisma extension under TENANCY_RLS=enforce when a query targets a
// tenant-scoped model without an established tenant context. Under RLS the database
// would silently return zero rows; this turns that silent empty result into a loud bug.
export class TenantContextMissing extends Error {
  readonly model: string;

  constructor(model: string) {
    super(`Tenant context missing for a query on "${model}" (TENANCY_RLS=enforce)`);
    this.name = "TenantContextMissing";
    this.model = model;
  }
}

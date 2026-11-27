import type { AdminUser, User } from "@prisma/client";

import type { TenantDb } from "./tenancy-users.js";

// Bridge between the legacy AdminUser row and the tenancy identity `User`.
// `User.email` and `AdminUser.email` are both unique and kept in sync by the
// mirrors, so the mapping is deterministic 1:1 (docs/design/tenancy.md §7). PAT
// rebinding to a User membership is deferred to PR 8; until then PATs resolve
// their owner through this email bridge.

export async function resolveAdminUserByEmail(
  db: TenantDb,
  email: string,
): Promise<AdminUser | null> {
  return db.adminUser.findUnique({ where: { email } });
}

// Resolves the identity-root User.id for a legacy AdminUser.id (AdminUser → User
// by email). Returns null when the AdminUser has not been mirrored into a User.
export async function resolveUserIdForAdminUser(
  db: TenantDb,
  adminUserId: string,
): Promise<string | null> {
  const adminUser = await db.adminUser.findUnique({
    where: { id: adminUserId },
    select: { email: true },
  });
  if (!adminUser) {
    return null;
  }
  const user = await db.user.findUnique({
    where: { email: adminUser.email },
    select: { id: true },
  });
  return user?.id ?? null;
}

// Inverse of `resolveUserIdForAdminUser`: the identity-root User for an email.
// Used by the PAT branch to load the owner's User + membership.
export async function resolveUserByEmail(db: TenantDb, email: string): Promise<User | null> {
  return db.user.findUnique({ where: { email } });
}

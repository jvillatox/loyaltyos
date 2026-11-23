import type { AdminRole, Prisma, PrismaClient } from "@prisma/client";

// Tenancy compatibility path (docs/design/tenancy.md §4 step 1). Until PR 7
// switches auth to the new identity tables, AdminUser stays the source of truth
// and every AdminUser write is mirrored to `User` + `OrganizationMembership` in
// the same transaction. Both functions are idempotent (upserts keyed on a
// deterministic org id / unique email / (userId, organizationId)).

export const DEFAULT_ORG_ID = "org_default";
export const DEFAULT_ORG_NAME = "Default";

export type TenantDb = PrismaClient | Prisma.TransactionClient;

// The subset of AdminUser that is mirrored onto User + membership.
export interface AdminUserMirror {
  email: string;
  passwordHash: string;
  name: string;
  isActive: boolean;
  locale: string;
  role: AdminRole;
  programId: string;
  lastLoginAt: Date | null;
}

export async function ensureDefaultOrganization(db: TenantDb) {
  return db.organization.upsert({
    where: { id: DEFAULT_ORG_ID },
    update: {},
    create: { id: DEFAULT_ORG_ID, name: DEFAULT_ORG_NAME },
  });
}

export async function syncAdminUserToTenancy(db: TenantDb, admin: AdminUserMirror): Promise<void> {
  const org = await ensureDefaultOrganization(db);
  const status = admin.isActive ? "ACTIVE" : "DISABLED";

  const user = await db.user.upsert({
    where: { email: admin.email },
    update: {
      passwordHash: admin.passwordHash,
      name: admin.name,
      status,
      locale: admin.locale,
      lastLoginAt: admin.lastLoginAt,
    },
    create: {
      email: admin.email,
      passwordHash: admin.passwordHash,
      name: admin.name,
      status,
      locale: admin.locale,
      lastLoginAt: admin.lastLoginAt,
    },
  });

  await db.organizationMembership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: {
      role: admin.role,
      programIds: [admin.programId],
      status,
    },
    create: {
      userId: user.id,
      organizationId: org.id,
      role: admin.role,
      programIds: [admin.programId],
      status,
    },
  });
}

// `User.email` is unique, so mirroring two AdminUsers that share an email would
// silently collapse them into one User. AdminUser.email is already unique, but
// guard the backfill anyway so a data violation fails with a clear message
// instead of a confusing upsert error deep in the transaction.
export function assertUniqueAdminEmails(emails: readonly string[]): void {
  const seen = new Set<string>();
  for (const email of emails) {
    if (seen.has(email)) {
      throw new Error(
        `Cannot backfill tenancy users: duplicate AdminUser email "${email}". AdminUser emails must be unique before the User table can be populated.`,
      );
    }
    seen.add(email);
  }
}

// Converts every AdminUser into a User + membership (docs/design/tenancy.md §4
// step 2). Idempotent: re-running produces the same rows. Callers that want
// atomicity wrap this in a `$transaction`.
export async function backfillTenancyUsers(db: TenantDb) {
  const admins = await db.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  assertUniqueAdminEmails(admins.map((admin) => admin.email));
  const org = await ensureDefaultOrganization(db);
  for (const admin of admins) {
    await syncAdminUserToTenancy(db, admin);
  }
  const [userCount, membershipCount] = await Promise.all([
    db.user.count(),
    db.organizationMembership.count(),
  ]);
  return { organization: org, userCount, membershipCount };
}

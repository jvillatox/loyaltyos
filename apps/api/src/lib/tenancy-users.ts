import type {
  AdminRole,
  AdminUser,
  MembershipStatus,
  OrganizationMembership,
  Prisma,
  PrismaClient,
  UserStatus,
} from "@prisma/client";

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

// ---------------------------------------------------------------------------
// Reverse mirror (docs/design/tenancy.md §7 row 7). Once auth reads the
// identity tables (PR 7), `User` + `OrganizationMembership` are the source of
// truth and `AdminUser` is the mirror kept in sync for the 2-release rollback
// window. The mirror represents ONLY the default-org membership (plan rule 10):
// in legacy mode a multi-org user can only reach the org bound to this mirror.
// ---------------------------------------------------------------------------

export interface TenancyUserMirror {
  user: {
    email: string;
    passwordHash: string | null;
    name: string;
    status: UserStatus;
    locale: string;
    lastLoginAt: Date | null;
  };
  membership: {
    role: AdminRole;
    programIds: string[];
    status: MembershipStatus;
  };
  // The program the mirror is bound to. Defaults to the membership's first
  // program; a whole-org membership (empty programIds) cannot be mirrored.
  programId?: string;
}

function resolveMirrorProgramId(
  membership: TenancyUserMirror["membership"],
  programId?: string,
): string {
  const resolved = programId ?? membership.programIds[0];
  if (!resolved) {
    throw new Error(
      "Cannot mirror an AdminUser for a membership with no programs (programIds is empty).",
    );
  }
  return resolved;
}

// Upserts the AdminUser mirror from a User + membership. The AdminUser is keyed
// on the unique email; isActive reflects BOTH the user and membership status so
// deactivating either immediately blocks legacy login.
export async function syncTenancyUserToAdminUser(
  db: TenantDb,
  input: TenancyUserMirror,
): Promise<AdminUser> {
  const passwordHash = input.user.passwordHash;
  if (!passwordHash) {
    throw new Error(`Cannot mirror AdminUser "${input.user.email}": User has no passwordHash.`);
  }
  const isActive = input.user.status === "ACTIVE" && input.membership.status === "ACTIVE";
  const programId = resolveMirrorProgramId(input.membership, input.programId);

  return db.adminUser.upsert({
    where: { email: input.user.email },
    update: {
      passwordHash,
      name: input.user.name,
      role: input.membership.role,
      isActive,
      locale: input.user.locale,
      programId,
      lastLoginAt: input.user.lastLoginAt,
    },
    create: {
      email: input.user.email,
      passwordHash,
      name: input.user.name,
      role: input.membership.role,
      isActive,
      locale: input.user.locale,
      programId,
      lastLoginAt: input.user.lastLoginAt,
    },
  });
}

export interface IdentityUserRef {
  id: string;
  email: string;
}

// Rule 7 (deterministic default org): prefer the ACTIVE membership containing
// the legacy AdminUser's program, else the oldest ACTIVE membership (createdAt
// ASC). Never "first" without a defined order. Returns null when the user has no
// ACTIVE membership.
export async function resolveDefaultMembership(
  db: TenantDb,
  user: IdentityUserRef,
): Promise<OrganizationMembership | null> {
  const memberships = await db.organizationMembership.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) {
    return null;
  }

  const adminUser = await db.adminUser.findUnique({
    where: { email: user.email },
    select: { programId: true },
  });
  if (adminUser) {
    const preferred = memberships.find(
      (m) => m.programIds.length === 0 || m.programIds.includes(adminUser.programId),
    );
    if (preferred) {
      return preferred;
    }
  }

  return memberships[0] ?? null;
}

export interface MembershipScope {
  organizationId: string;
  programIds: string[];
}

// Rule 8 (program scope): a program is in scope when it belongs to the active
// org and — unless the membership is whole-org (empty programIds) — is listed in
// `membership.programIds`.
export async function validateProgramInMembership(
  db: TenantDb,
  membership: MembershipScope,
  programId: string,
): Promise<boolean> {
  if (membership.programIds.length > 0 && !membership.programIds.includes(programId)) {
    return false;
  }
  const program = await db.program.findUnique({
    where: { id: programId },
    select: { organizationId: true },
  });
  return program?.organizationId === membership.organizationId;
}

// Resolves the default active program for a membership: the caller's preferred
// program (e.g. the legacy AdminUser's program) when still in scope, else the
// first in-scope program in `programIds`. Whole-org memberships resolve to null
// (no single program is selected).
export async function resolveDefaultProgramId(
  db: TenantDb,
  membership: MembershipScope,
  preferredProgramId: string | null,
): Promise<string | null> {
  const candidates = preferredProgramId
    ? [preferredProgramId, ...membership.programIds]
    : membership.programIds;
  for (const candidate of candidates) {
    if (await validateProgramInMembership(db, membership, candidate)) {
      return candidate;
    }
  }
  return null;
}

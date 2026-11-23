import { PrismaClient } from "@prisma/client";

import { redactSecrets } from "./lib/provision-db-roles.js";
import { backfillTenancyUsers, DEFAULT_ORG_NAME } from "./lib/tenancy-users.js";

// Idempotent backfill of the tenancy identity tables (docs/design/tenancy.md
// §4 step 2). Creates the single `default` Organization and mirrors every
// AdminUser into a `User` (by unique email) plus an `OrganizationMembership` in
// that org (role + programIds=[its programId]). Re-running is a no-op thanks to
// the upserts. Runs under the owner URL (MIGRATION_DATABASE_URL, falling back to
// DATABASE_URL), like migrations and the other administrative scripts.

async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error(
      "Tenancy backfill skipped: neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.",
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  try {
    if (dryRun) {
      const admins = await db.adminUser.findMany({ orderBy: { createdAt: "asc" } });
      console.log(
        `[dry-run] Would ensure the "${DEFAULT_ORG_NAME}" organization and mirror ${String(admins.length)} AdminUser(s) into User + OrganizationMembership.`,
      );
      for (const admin of admins) {
        console.log(
          `[dry-run]   ${admin.email} -> role=${admin.role} programIds=[${admin.programId}]`,
        );
      }
      return;
    }

    await db.$transaction(async (tx) => {
      const result = await backfillTenancyUsers(tx);
      console.log(
        `Tenancy backfill complete: organization "${result.organization.name}" (${result.organization.id}); ${String(result.userCount)} User(s), ${String(result.membershipCount)} membership(s).`,
      );
    });
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const secrets = [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL].filter(
    (value): value is string => Boolean(value),
  );
  console.error(
    "Tenancy backfill failed:",
    redactSecrets(error instanceof Error ? error.message : String(error), secrets),
  );
  process.exit(1);
});

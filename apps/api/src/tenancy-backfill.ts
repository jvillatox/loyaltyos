import { PrismaClient } from "@prisma/client";

import { redactSecrets } from "./lib/provision-db-roles.js";
import { backfillOrganizationColumns } from "./lib/tenancy-org.js";

// CLI for docs/design/tenancy.md §4 step 2: fill the nullable `organizationId` on
// every §3.1 business table from the default Organization. Runs under the owner URL
// (MIGRATION_DATABASE_URL, falling back to DATABASE_URL) because a backfill UPDATE
// under the app role would be filtered by RLS once enabled. Batched, idempotent and
// resumable; `--dry-run` reports per-table row counts without writing.

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
    const result = await backfillOrganizationColumns(db, { dryRun });
    if (dryRun) {
      console.log(`[dry-run] Would backfill organization "${result.organizationId}".`);
    } else {
      console.log(
        `Tenancy backfill complete: organization "${result.organizationId}"; ${String(result.programCount)} Program(s).`,
      );
    }
    for (const [table, count] of Object.entries(result.tableCounts)) {
      if (count > 0) {
        console.log(`  ${table}: ${String(count)}`);
      }
    }
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

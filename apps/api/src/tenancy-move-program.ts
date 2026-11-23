import { PrismaClient } from "@prisma/client";

import { redactSecrets } from "./lib/provision-db-roles.js";
import { moveProgram } from "./lib/tenancy-move-program.js";

// CLI for docs/design/tenancy.md §4 step 2: move a Program (and every row that
// carries its `organizationId`) to a different Organization in one transaction.
// The composite FKs are DEFERRABLE INITIALLY DEFERRED precisely so this rewrite does
// not transiently violate them. Usage: tenancy:move-program <programId> <organizationId>.

async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error(
      "tenancy:move-program skipped: neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.",
    );
    process.exit(1);
  }

  const [programId, organizationId] = process.argv.slice(2);
  if (!programId || !organizationId) {
    console.error("Usage: tenancy:move-program <programId> <organizationId>");
    process.exit(1);
  }

  const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  try {
    const result = await moveProgram(db, programId, organizationId);
    const moved = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
    console.log(
      `Moved program "${result.programId}" to organization "${result.organizationId}": ${String(moved)} row(s) across ${String(Object.keys(result.counts).length)} table(s).`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const secrets = [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL].filter(
    (value): value is string => Boolean(value),
  );
  console.error(
    "tenancy:move-program failed:",
    redactSecrets(error instanceof Error ? error.message : String(error), secrets),
  );
  process.exit(1);
});

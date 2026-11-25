import { resolveTenantRlsMode } from "@loyaltyos/tenancy";
import { PrismaClient } from "@prisma/client";

import {
  APP_ROLE,
  LIST_ORGS_FUNCTION,
  provisionRoles,
  redactSecrets,
} from "./lib/provision-db-roles.js";
import { provisionRlsPolicies } from "./lib/provision-rls-policies.js";

// Idempotent tenancy role provisioning (docs/design/tenancy.md §2.3).
//
// Creates the least-privileged runtime role `loyaltyos_app` and the
// `app_list_organization_ids()` SECURITY DEFINER function, granting the app role
// DML on the current tables plus ALTER DEFAULT PRIVILEGES so tables created by
// future migrations stay accessible. Runs as the owner (MIGRATION_DATABASE_URL,
// falling back to DATABASE_URL); passwords come from env, never the repo. The
// owner role must have CREATEROLE (see .env.example and docs/design/tenancy.md).

async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error(
      "Tenancy role provisioning skipped: neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.",
    );
    process.exit(1);
  }

  const appPassword = process.env.LOYALTYOS_APP_DB_PASSWORD;
  if (!appPassword) {
    console.log(
      "LOYALTYOS_APP_DB_PASSWORD is not set; skipping role provisioning (single-URL mode).",
    );
    return;
  }

  const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  try {
    await provisionRoles(db, appPassword);
    console.log(
      `Tenancy roles provisioned: ${APP_ROLE} (NOSUPERUSER NOBYPASSRLS) + ${LIST_ORGS_FUNCTION}().`,
    );

    // Row-level security policies (docs/design/tenancy.md §4 step 3): installed
    // under audit/enforce, dropped under off so the default deployment stays
    // behaviorally identical to an un-extended client.
    const mode = resolveTenantRlsMode();
    await provisionRlsPolicies(db, mode);
    console.log(`Tenancy RLS policies ${mode === "off" ? "disabled" : `enabled (${mode})`}.`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const secrets = [
    process.env.LOYALTYOS_APP_DB_PASSWORD,
    process.env.MIGRATION_DATABASE_URL,
    process.env.DATABASE_URL,
  ].filter((value): value is string => Boolean(value));
  console.error(
    "Tenancy role provisioning failed:",
    redactSecrets(error instanceof Error ? error.message : String(error), secrets),
  );
  process.exit(1);
});

import { PrismaClient } from "@prisma/client";

// Idempotent tenancy role provisioning (docs/design/tenancy.md §2.3).
//
// Creates the least-privileged runtime role `loyaltyos_app` and the
// `loyaltyos_platform` BYPASSRLS role, then grants the app role DML on the
// current tables plus ALTER DEFAULT PRIVILEGES so tables created by future
// migrations stay accessible. Runs as the owner (MIGRATION_DATABASE_URL,
// falling back to DATABASE_URL); passwords come from env, never the repo.

const APP_ROLE = "loyaltyos_app";
const PLATFORM_ROLE = "loyaltyos_platform";

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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

  const platformPassword = process.env.LOYALTYOS_PLATFORM_DB_PASSWORD;

  const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  try {
    // App role — the runtime connection. Never a superuser, never BYPASSRLS.
    await db.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = ${sqlLiteral(APP_ROLE)}) THEN
          ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${sqlLiteral(appPassword)};
        ELSE
          CREATE ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${sqlLiteral(appPassword)};
        END IF;
      END
      $$;
    `);

    // Platform role — BYPASSRLS, reserved for listing organizations in worker
    // sweeps. Without a password it is created NOLOGIN (inert).
    const platformAttrs = platformPassword
      ? `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD ${sqlLiteral(platformPassword)}`
      : `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS`;
    await db.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = ${sqlLiteral(PLATFORM_ROLE)}) THEN
          ALTER ROLE ${PLATFORM_ROLE} WITH ${platformAttrs};
        ELSE
          CREATE ROLE ${PLATFORM_ROLE} WITH ${platformAttrs};
        END IF;
      END
      $$;
    `);

    // Grants on objects that already exist.
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`);
    await db.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};`,
    );
    await db.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
    );

    // The app role must never be able to forge or corrupt migration history.
    await db.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
          REVOKE ALL ON TABLE public."_prisma_migrations" FROM ${APP_ROLE};
        END IF;
      END
      $$;
    `);

    // Tables/sequences created by future migrations (run as this same owner
    // role) inherit these grants automatically.
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`,
    );
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
    );

    console.log(
      `Tenancy roles provisioned: ${APP_ROLE}, ${PLATFORM_ROLE} (${platformPassword ? "LOGIN" : "NOLOGIN"}).`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Tenancy role provisioning failed:", (error as Error).message);
  process.exit(1);
});

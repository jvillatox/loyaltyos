import type { PrismaClient } from "@prisma/client";

export const APP_ROLE = "loyaltyos_app";
export const LIST_ORGS_FUNCTION = "app_list_organization_ids";

export type ProvisionDb = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

// Quotes a role password as a dollar-quoted string literal with a tag that is
// guaranteed not to appear in the password. Unlike '…' quoting, this is safe for
// any content (single quotes, `$$`, backslashes, newlines) without escaping.
export function quotePassword(password: string): string {
  const tag = "loyaltyos_pw";
  let suffix = "";
  while (password.includes(`${tag}${suffix}`)) {
    suffix += "_";
  }
  const finalTag = `${tag}${suffix}`;
  return `$${finalTag}$${password}$${finalTag}$`;
}

// Strips secrets (and any URL userinfo) from a message before it is logged.
export function redactSecrets(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  // Safety net for credentialed URLs that were not in the explicit secret list
  // (e.g. Prisma's own connection error). Matches scheme://user:pass@.
  out = out.replace(/(:\/\/)[^/@\s]+@/g, "$1[REDACTED]@");
  return out;
}

async function execRaw(db: ProvisionDb, sql: string, secrets: readonly string[]): Promise<void> {
  try {
    await db.$executeRawUnsafe(sql);
  } catch (error) {
    throw new Error(redactSecrets((error as Error).message, secrets));
  }
}

// Idempotent tenancy role provisioning (docs/design/tenancy.md §2.3).
//
// Creates the least-privileged runtime role `loyaltyos_app` (LOGIN NOSUPERUSER
// NOBYPASSRLS), grants it DML on current tables plus ALTER DEFAULT PRIVILEGES,
// and installs a SECURITY DEFINER `app_list_organization_ids()` function owned by
// the migration owner so worker sweeps can list organizations without any
// BYPASSRLS runtime role. Role existence is checked here (in TypeScript), never
// in a `DO $$` block, so the password is only ever embedded via a safely
// dollar-quoted literal. The owner role must have CREATEROLE.
export async function provisionRoles(db: ProvisionDb, appPassword: string): Promise<void> {
  const secrets = [appPassword];
  const quotedPassword = quotePassword(appPassword);

  const existsRows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') AS "exists"`,
  );
  const exists = existsRows[0]?.exists ?? false;
  const action = exists ? "ALTER ROLE" : "CREATE ROLE";

  await execRaw(
    db,
    `${action} ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quotedPassword}`,
    secrets,
  );

  await execRaw(db, `GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`, secrets);
  await execRaw(
    db,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};`,
    secrets,
  );
  await execRaw(
    db,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
    secrets,
  );

  // The app role must never be able to forge or corrupt migration history.
  await execRaw(
    db,
    `DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
        REVOKE ALL ON TABLE public."_prisma_migrations" FROM ${APP_ROLE};
      END IF;
    END
    $$;`,
    secrets,
  );

  // Tables/sequences created by future migrations (run as this same owner role)
  // inherit these grants automatically.
  await execRaw(
    db,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`,
    secrets,
  );
  await execRaw(
    db,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
    secrets,
  );

  // Lists organization ids for worker sweeps. SECURITY DEFINER runs as its owner
  // (which owns the tables) and returns only ids, so no runtime role needs
  // BYPASSRLS. plpgsql keeps the body from being validated against "Organization"
  // until the table exists (created by a later PR).
  await execRaw(
    db,
    `CREATE OR REPLACE FUNCTION public.${LIST_ORGS_FUNCTION}()
RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY SELECT id FROM public."Organization" ORDER BY id;
END
$fn$;`,
    secrets,
  );
  await execRaw(
    db,
    `GRANT EXECUTE ON FUNCTION public.${LIST_ORGS_FUNCTION}() TO ${APP_ROLE};`,
    secrets,
  );
}

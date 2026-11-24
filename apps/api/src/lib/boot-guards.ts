import { MIN_MASTER_KEY_LENGTH } from "@loyaltyos/coalition";
import type { TenantRlsMode } from "@loyaltyos/tenancy";
import { resolveTenantRlsMode } from "@loyaltyos/tenancy";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";

export const DEFAULT_DEV_API_KEY = "dev-key";

// Boot-time guard: in production, refuse to start while the master encryption key
// is missing or too short. Coalition credentials are encrypted with this key, so a
// weak or absent key means they cannot be decrypted (or were encrypted with the
// publicly-known development fallback).
export function assertMasterKeyConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;

  const key = process.env.KMS_MASTER_KEY;
  if (!key || key.length < MIN_MASTER_KEY_LENGTH) {
    throw new Error(
      `Refusing to start in production: KMS_MASTER_KEY is ${
        key ? `too short (${String(key.length)} characters)` : "not set"
      }. ` +
        `Set KMS_MASTER_KEY to at least ${String(MIN_MASTER_KEY_LENGTH)} characters. ` +
        "If coalition credentials were encrypted with the development fallback key, run " +
        "`pnpm --filter @loyaltyos/api coalition:reencrypt --from-key <old-key>` to migrate them.",
    );
  }
}

// Boot-time guard: in production, refuse to start while the seeded "dev-key"
// API key is still active. The admin UI now authenticates exclusively with the
// session cookie, and a well-known SERVER-scope key is an obvious target.
export async function assertNoDefaultApiKey(
  db: Pick<PrismaClient, "apiKey"> = prisma,
): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const existing = await db.apiKey.findFirst({
    where: { key: DEFAULT_DEV_API_KEY, isActive: true },
  });

  if (existing) {
    throw new Error(
      `Refusing to start in production: the API key "${DEFAULT_DEV_API_KEY}" is still active. ` +
        "Delete or rotate it before deploying — this key is only intended for local development.",
    );
  }
}

export type { TenantRlsMode };
export { resolveTenantRlsMode };

export interface DbRoleInfo {
  isSuperuser: boolean;
  bypassesRls: boolean;
}

// Pure decision for the tenancy DB-role boot guard. Under `audit`/`enforce` the
// runtime must never connect as a superuser or a BYPASSRLS role — either would
// silently bypass row-level security. Under `off` the guard only warns.
export function evaluateDbRoleGuard(
  mode: TenantRlsMode,
  role: DbRoleInfo,
): { blocked: boolean; reason?: string } {
  if (mode === "off") return { blocked: false };

  if (role.isSuperuser || role.bypassesRls) {
    const kind = role.isSuperuser ? "superuser" : "role with BYPASSRLS";
    return {
      blocked: true,
      reason:
        `Refusing to start: TENANCY_RLS=${mode} but DATABASE_URL connects as a ${kind} ` +
        `role. Use the least-privileged "loyaltyos_app" role for DATABASE_URL and the ` +
        "owner role for MIGRATION_DATABASE_URL.",
    };
  }

  return { blocked: false };
}

// Boot-time guard: refuses to start under `audit`/`enforce` when the connection
// role can bypass RLS. Resolves current_user via pg_roles (superusers and
// BYPASSRLS roles are not listed by name, so we query the attribute flags).
export async function assertTenantDbRole(
  db: Pick<PrismaClient, "$queryRawUnsafe"> = prisma,
): Promise<void> {
  const mode = resolveTenantRlsMode();

  if (mode === "off") {
    console.warn("[tenancy] TENANCY_RLS=off; row-level security is not enforced.");
    return;
  }

  const rows = await db.$queryRawUnsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  const roleInfo = rows[0] ?? { rolsuper: false, rolbypassrls: false };

  const result = evaluateDbRoleGuard(mode, {
    isSuperuser: roleInfo.rolsuper,
    bypassesRls: roleInfo.rolbypassrls,
  });

  if (result.blocked) {
    throw new Error(result.reason);
  }
}

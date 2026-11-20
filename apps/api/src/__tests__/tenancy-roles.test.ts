import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadDotEnv } from "../db.js";
import {
  assertTenantDbRole,
  evaluateDbRoleGuard,
  resolveTenantRlsMode,
} from "../lib/boot-guards.js";
import {
  APP_ROLE,
  LIST_ORGS_FUNCTION,
  provisionRoles,
  quotePassword,
  redactSecrets,
} from "../lib/provision-db-roles.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveTenantRlsMode", () => {
  it("defaults to off when unset or unknown", () => {
    vi.stubEnv("TENANCY_RLS", undefined);
    expect(resolveTenantRlsMode()).toBe("off");

    vi.stubEnv("TENANCY_RLS", "bogus");
    expect(resolveTenantRlsMode()).toBe("off");
  });

  it("recognizes audit and enforce, case-insensitively", () => {
    vi.stubEnv("TENANCY_RLS", "audit");
    expect(resolveTenantRlsMode()).toBe("audit");

    vi.stubEnv("TENANCY_RLS", "Enforce");
    expect(resolveTenantRlsMode()).toBe("enforce");
  });
});

describe("evaluateDbRoleGuard", () => {
  it("never blocks in off mode, even for a superuser", () => {
    expect(evaluateDbRoleGuard("off", { isSuperuser: true, bypassesRls: false })).toEqual({
      blocked: false,
    });
  });

  it("blocks a superuser under audit and enforce", () => {
    for (const mode of ["audit", "enforce"] as const) {
      const result = evaluateDbRoleGuard(mode, { isSuperuser: true, bypassesRls: false });
      expect(result.blocked).toBe(true);
      expect(result.reason).toMatch(/superuser/);
    }
  });

  it("blocks a BYPASSRLS role under audit and enforce", () => {
    const result = evaluateDbRoleGuard("enforce", { isSuperuser: false, bypassesRls: true });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/BYPASSRLS/);
  });

  it("allows a least-privileged role under audit and enforce", () => {
    expect(evaluateDbRoleGuard("enforce", { isSuperuser: false, bypassesRls: false })).toEqual({
      blocked: false,
    });
  });
});

describe("assertTenantDbRole", () => {
  function mockDb(role: { rolsuper: boolean; rolbypassrls: boolean }) {
    return { $queryRawUnsafe: vi.fn().mockResolvedValue([role]) };
  }

  it("does not query the database in off mode", async () => {
    vi.stubEnv("TENANCY_RLS", "off");
    const db = mockDb({ rolsuper: true, rolbypassrls: true });

    await expect(assertTenantDbRole(db)).resolves.toBeUndefined();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("throws under audit when the connection role is a superuser", async () => {
    vi.stubEnv("TENANCY_RLS", "audit");
    const db = mockDb({ rolsuper: true, rolbypassrls: false });

    await expect(assertTenantDbRole(db)).rejects.toThrow(/superuser/);
  });

  it("throws under enforce when the connection role has BYPASSRLS", async () => {
    vi.stubEnv("TENANCY_RLS", "enforce");
    const db = mockDb({ rolsuper: false, rolbypassrls: true });

    await expect(assertTenantDbRole(db)).rejects.toThrow(/BYPASSRLS/);
  });

  it("resolves under audit with a least-privileged role", async () => {
    vi.stubEnv("TENANCY_RLS", "audit");
    const db = mockDb({ rolsuper: false, rolbypassrls: false });

    await expect(assertTenantDbRole(db)).resolves.toBeUndefined();
  });
});

describe("quotePassword", () => {
  it("round-trips a password containing a quote, dollar-quotes, and a backslash", () => {
    const password = "p'a$$b\\c";
    const quoted = quotePassword(password);

    expect(quoted.startsWith("$")).toBe(true);
    expect(quoted.endsWith("$")).toBe(true);

    const secondDollar = quoted.indexOf("$", 1);
    const tag = quoted.slice(1, secondDollar);
    const closing = `$${tag}$`;
    expect(quoted.endsWith(closing)).toBe(true);

    const inner = quoted.slice(secondDollar + 1, quoted.length - closing.length);
    expect(inner).toBe(password);
    // The tag must never appear inside the password, or the dollar-quote could
    // close early.
    expect(password.includes(tag)).toBe(false);
  });

  it("picks a different tag when the password contains the default tag", () => {
    const password = "loyaltyos_pw_present";
    const quoted = quotePassword(password);
    expect(quoted).not.toBe(`$loyaltyos_pw$${password}$loyaltyos_pw$`);
    expect(password.includes(quoted.slice(1, quoted.indexOf("$", 1)))).toBe(false);
  });
});

describe("redactSecrets", () => {
  it("removes a password and a credentialed URL from an error message", () => {
    const password = "s3cr3t";
    const url = "postgresql://owner:s3cr3t@db:5432/loyaltyos";
    const message = `failed: PASSWORD $tag$${password}$tag$ at ${url}`;
    const redacted = redactSecrets(message, [password, url]);

    expect(redacted).not.toContain(password);
    expect(redacted).not.toContain("owner:s3cr3t");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts URL credentials even when not in the explicit secret list", () => {
    const message = "connection refused at postgresql://user:hunter2@db:5432/db";
    const redacted = redactSecrets(message, []);

    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("postgresql://[REDACTED]@");
  });
});

describe("provisionRoles", () => {
  function mockDb(options?: { exists?: boolean; executeError?: Error }) {
    return {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ exists: options?.exists ?? false }]),
      $executeRawUnsafe: options?.executeError
        ? vi.fn().mockRejectedValue(options.executeError)
        : vi.fn().mockResolvedValue(0),
    };
  }

  it("creates (not alters) the app role when it does not yet exist", async () => {
    const db = mockDb({ exists: false });

    await provisionRoles(db, "pw");

    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`CREATE ROLE ${APP_ROLE}`),
    );
    expect(db.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining(`ALTER ROLE ${APP_ROLE}`),
    );
  });

  it("alters the app role when it already exists", async () => {
    const db = mockDb({ exists: true });

    await provisionRoles(db, "pw");

    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`ALTER ROLE ${APP_ROLE}`),
    );
    expect(db.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining(`CREATE ROLE ${APP_ROLE}`),
    );
  });

  it("provisions no BYPASSRLS runtime role and installs the listing function", async () => {
    const db = mockDb({ exists: false });

    await provisionRoles(db, "pw");

    const sql = db.$executeRawUnsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("NOBYPASSRLS");
    expect(sql).not.toContain("loyaltyos_platform");
    expect(sql).toContain(LIST_ORGS_FUNCTION);
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION public.${LIST_ORGS_FUNCTION}() TO ${APP_ROLE}`,
    );
  });

  it("never leaks the password when a statement fails", async () => {
    const password = "s3cr3t-pw";
    const db = mockDb({
      exists: false,
      executeError: new Error(`syntax error at or near "$loyaltyos_pw$${password}$loyaltyos_pw$"`),
    });

    const error = await provisionRoles(db, password).catch((err) => err as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(password);
    expect(error.message).toContain("[REDACTED]");
  });
});

// Integration: requires a provisioned database (CI runs the provision script as
// the owner and points DATABASE_URL at the app role). Skipped locally without it.
//
// turbo forwards only a curated set of env vars to task processes, so the job
// `env:` block never reaches vitest. Load the .env at runtime (as db.ts does)
// and read the values through dynamic access so the URLs/password resolve.
loadDotEnv();
const env = (name: string): string | undefined => process.env[name];
const ownerUrl = env("MIGRATION_DATABASE_URL") || env("TEST_DATABASE_URL");
const appUrl = env("DATABASE_URL");
const appPassword = env("LOYALTYOS_APP_DB_PASSWORD");

describe.skipIf(!ownerUrl || !appUrl || !appPassword)("tenancy DB roles (integration)", () => {
  it("provisions loyaltyos_app as neither superuser nor BYPASSRLS", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });
    try {
      const rows = await owner.$queryRawUnsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'loyaltyos_app'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rolsuper).toBe(false);
      expect(rows[0]!.rolbypassrls).toBe(false);
    } finally {
      await owner.$disconnect();
    }
  });

  it("does not create a loyaltyos_platform BYPASSRLS role", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });
    try {
      const rows = await owner.$queryRawUnsafe<{ rolname: string }[]>(
        `SELECT rolname FROM pg_roles WHERE rolname = 'loyaltyos_platform'`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await owner.$disconnect();
    }
  });

  it("grants the app role access to a table created by a later migration", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });
    const app = new PrismaClient({ datasources: { db: { url: appUrl! } } });
    const table = "tenancy_provision_check";
    try {
      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
      await owner.$executeRawUnsafe(`CREATE TABLE "${table}" (id text PRIMARY KEY)`);
      // ALTER DEFAULT PRIVILEGES must grant the app role DML on tables created
      // by the owner after provisioning.
      await app.$executeRawUnsafe(`INSERT INTO "${table}" (id) VALUES ('probe')`);
      await app.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id = 'probe'`);
    } finally {
      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`).catch(() => undefined);
      await app.$disconnect();
      await owner.$disconnect();
    }
  });

  it("connects with a password containing a quote, dollar-quotes, and a backslash", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });
    const role = "loyaltyos_provision_escape_test";
    const password = "p'a$$b\\c";
    const base = new URL(ownerUrl!);
    const probeUrl = `postgresql://${role}:${encodeURIComponent(password)}@${base.host}${base.pathname}${base.search}`;
    try {
      await owner.$executeRawUnsafe(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${quotePassword(password)}`,
      );
      const probe = new PrismaClient({ datasources: { db: { url: probeUrl } } });
      try {
        await probe.$queryRawUnsafe(`SELECT 1`);
      } finally {
        await probe.$disconnect();
      }
    } finally {
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      await owner.$disconnect();
    }
  });
});

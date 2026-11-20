import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertTenantDbRole,
  evaluateDbRoleGuard,
  resolveTenantRlsMode,
} from "../lib/boot-guards.js";

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

// Integration: requires a provisioned database (CI runs the provision script as
// the owner and points DATABASE_URL at the app role). Skipped locally without it.
const ownerUrl = process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;
const appPassword = process.env.LOYALTYOS_APP_DB_PASSWORD;

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
});

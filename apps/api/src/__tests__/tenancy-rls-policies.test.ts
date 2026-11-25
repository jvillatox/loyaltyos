import { GLOBAL_MODELS } from "@loyaltyos/tenancy";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  assertEnforceReady,
  disableRlsPolicies,
  enableRlsPolicies,
  provisionRlsPolicies,
  RLS_POLICY_NAME,
  TENANT_TABLES,
} from "../lib/provision-rls-policies.js";

// Contract guard: TENANT_TABLES must track the schema exactly — every Prisma
// model with an organizationId column, minus the global tables (§3.2). Deriving
// the expectation from the generated DMMF means a new tenant table fails this
// test until it is added to (or removed from) TENANT_TABLES.
describe("TENANT_TABLES contract", () => {
  it("covers exactly the non-global models with an organizationId column", () => {
    const expected = Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === "organizationId"))
      .map((model) => model.name)
      .filter((name) => !GLOBAL_MODELS.has(name))
      .sort();

    expect([...TENANT_TABLES].sort()).toEqual(expected);
  });
});

describe("enableRlsPolicies", () => {
  function mockDb() {
    return { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
  }

  it("enables and forces RLS plus an org-isolation policy on every tenant table", async () => {
    const db = mockDb();

    await enableRlsPolicies(db);

    const calls = db.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(calls).toHaveLength(TENANT_TABLES.length * 4);

    const firstTable = TENANT_TABLES[0]!;
    expect(calls).toContain(`ALTER TABLE "${firstTable}" ENABLE ROW LEVEL SECURITY`);
    expect(calls).toContain(`ALTER TABLE "${firstTable}" FORCE ROW LEVEL SECURITY`);
    expect(calls).toContain(`DROP POLICY IF EXISTS ${RLS_POLICY_NAME} ON "${firstTable}"`);
    expect(calls).toContain(
      `CREATE POLICY ${RLS_POLICY_NAME} ON "${firstTable}" ` +
        `USING ("organizationId" = current_setting('app.organization_id', true)::text) ` +
        `WITH CHECK ("organizationId" = current_setting('app.organization_id', true)::text)`,
    );
  });
});

describe("disableRlsPolicies", () => {
  it("drops the policy and disables RLS on every tenant table", async () => {
    const db = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };

    await disableRlsPolicies(db);

    const calls = db.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
    expect(calls).toHaveLength(TENANT_TABLES.length * 2);

    const firstTable = TENANT_TABLES[0]!;
    expect(calls).toContain(`DROP POLICY IF EXISTS ${RLS_POLICY_NAME} ON "${firstTable}"`);
    expect(calls).toContain(`ALTER TABLE "${firstTable}" DISABLE ROW LEVEL SECURITY`);
  });
});

describe("provisionRlsPolicies", () => {
  it("installs policies only under enforce; audit and off leave the DB un-policied", async () => {
    const enforceDb = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
    await provisionRlsPolicies(enforceDb, "enforce");
    expect(enforceDb.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("ENABLE ROW LEVEL SECURITY"),
    );
    expect(enforceDb.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("DISABLE ROW LEVEL SECURITY"),
    );

    // audit observes at the application layer only — Postgres cannot "log-only"
    // a denial, so it must not install policies (which would silently zero out
    // the not-yet-org-scoped worker sweeps).
    const auditDb = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
    await provisionRlsPolicies(auditDb, "audit");
    expect(auditDb.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DISABLE ROW LEVEL SECURITY"),
    );
    expect(auditDb.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("ENABLE ROW LEVEL SECURITY"),
    );

    const offDb = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
    await provisionRlsPolicies(offDb, "off");
    expect(offDb.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DISABLE ROW LEVEL SECURITY"),
    );
    expect(offDb.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("ENABLE ROW LEVEL SECURITY"),
    );
  });

  it("reconciles audit → enforce → off idempotently", async () => {
    // A single mock receives the whole sequence, proving each mode drives the
    // full ENABLE/FORCE+policy set (enforce) or the DROP+DISABLE set (audit/off).
    const db = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };

    await provisionRlsPolicies(db, "audit");
    await provisionRlsPolicies(db, "enforce");
    await provisionRlsPolicies(db, "off");

    const calls = db.$executeRawUnsafe.mock.calls.map((call) => String(call[0]));
    // audit + off each drop the policy and disable RLS on every table; enforce
    // enables + forces + drops + creates on every table.
    expect(calls.filter((c) => c.includes("DISABLE ROW LEVEL SECURITY"))).toHaveLength(
      TENANT_TABLES.length * 2,
    );
    expect(calls.filter((c) => c.includes("ENABLE ROW LEVEL SECURITY"))).toHaveLength(
      TENANT_TABLES.length,
    );
    expect(calls.filter((c) => c.includes("FORCE ROW LEVEL SECURITY"))).toHaveLength(
      TENANT_TABLES.length,
    );
    expect(
      calls.filter((c) => c.startsWith(`DROP POLICY IF EXISTS ${RLS_POLICY_NAME}`)),
    ).toHaveLength(TENANT_TABLES.length * 3);
    expect(calls.filter((c) => c.startsWith(`CREATE POLICY ${RLS_POLICY_NAME}`))).toHaveLength(
      TENANT_TABLES.length,
    );
  });
});

describe("assertEnforceReady", () => {
  it("throws a clear message while worker sweeps are not org-scoped", () => {
    expect(() => assertEnforceReady(false)).toThrow(/PR 11/);
    expect(() => assertEnforceReady(false)).toThrow(/TENANCY_RLS=enforce/);
  });

  it("passes once worker sweeps are org-scoped", () => {
    expect(() => assertEnforceReady(true)).not.toThrow();
  });
});

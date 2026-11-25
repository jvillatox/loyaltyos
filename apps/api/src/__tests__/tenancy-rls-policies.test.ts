import { GLOBAL_MODELS } from "@loyaltyos/tenancy";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
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
  it("enables policies under audit and enforce, disables under off", async () => {
    const enableDb = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
    await provisionRlsPolicies(enableDb, "enforce");
    expect(enableDb.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("ENABLE ROW LEVEL SECURITY"),
    );

    const auditDb = { $executeRawUnsafe: vi.fn().mockResolvedValue(0) };
    await provisionRlsPolicies(auditDb, "audit");
    expect(auditDb.$executeRawUnsafe).toHaveBeenCalledWith(
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
});

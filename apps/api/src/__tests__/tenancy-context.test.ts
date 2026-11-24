// Tenancy context extension against a real PostgreSQL database
// (docs/design/tenancy.md §2.2, PR 4 of the tenancy plan). Runs only when an
// owner DB URL is available (migrated LoyaltyOS schema), and provisions its own
// least-privileged role, a probe table with a test-created RLS policy, and the
// SECURITY DEFINER `app_org_for_program` function so it is self-contained in CI
// and locally alike.
//
// Proves six invariants of the transaction-aware extension:
//   1. `set_config` is issued once at the start of an interactive transaction
//      (multiple statements succeed inside it — no per-query nested transaction)
//      and the GUC is transaction-local (cleared after commit).
//   2. A loose query is wrapped as a batch transaction and raw queries carry
//      context too.
//   3. Raw `SELECT … FOR UPDATE` respects RLS (test-created policy).
//   4. No tenant context leaks across requests on a shared connection.
//   5. Missing context is fail-visible: `enforce` throws `TenantContextMissing`,
//      `audit` invokes the callback without throwing.
//   6. The SECURITY DEFINER function returns only the org id and resists SQL
//      injection; 20 concurrent ledger-style transactions are lossless.
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createTenantPrismaClient,
  resolveOrganizationId,
  runWithTenant,
  TenantContextMissing,
} from "@loyaltyos/tenancy";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ownerUrl =
  process.env.TEST_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (process.env.CI === "true" && !ownerUrl) {
  throw new Error("A database URL is required in CI (tenancy-context tests must not be skipped)");
}

const ORG_A = `org_ctx_a_${Date.now()}`;
const ORG_B = `org_ctx_b_${Date.now()}`;
const PROG_A = `prog_ctx_a_${Date.now()}`;
const APP_ROLE_NAME = "tenancy_ctx_app";
const APP_ROLE_PASSWORD = "tenancy_ctx_app_pw";

const PROBE_TABLE = "tenancy_context_probe";
const COUNTER_TABLE = "tenancy_context_counter";

function appRoleUrlFrom(owner: string): string {
  const base = new URL(owner);
  return `${base.protocol}//${APP_ROLE_NAME}:${encodeURIComponent(APP_ROLE_PASSWORD)}@${base.host}${base.pathname}${base.search}`;
}

describe.skipIf(!ownerUrl)("tenancy context extension (PostgreSQL)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let enforceOwner: PrismaClient;
  let enforceApp: PrismaClient;
  let createdAppOrgForProgram = false;

  beforeAll(async () => {
    owner = new PrismaClient({ datasources: { db: { url: ownerUrl! } } });

    // Least-privileged role for RLS enforcement (superusers bypass RLS).
    await owner.$executeRawUnsafe(`DROP OWNED BY ${APP_ROLE_NAME}`).catch(() => undefined);
    await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP_ROLE_NAME}`);
    await owner.$executeRawUnsafe(
      `CREATE ROLE ${APP_ROLE_NAME} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`,
    );

    // Probe table with a test-created RLS policy keyed to the tenant GUC.
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
    await owner.$executeRawUnsafe(
      `CREATE TABLE "${PROBE_TABLE}" (organization_id text NOT NULL, payload text NOT NULL)`,
    );
    await owner.$executeRawUnsafe(`ALTER TABLE "${PROBE_TABLE}" ENABLE ROW LEVEL SECURITY`);
    await owner.$executeRawUnsafe(`ALTER TABLE "${PROBE_TABLE}" FORCE ROW LEVEL SECURITY`);
    await owner.$executeRawUnsafe(`DROP POLICY IF EXISTS tenancy_probe_policy ON "${PROBE_TABLE}"`);
    await owner.$executeRawUnsafe(
      `CREATE POLICY tenancy_probe_policy ON "${PROBE_TABLE}" USING (organization_id = current_setting('app.organization_id', true))`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "${PROBE_TABLE}" (organization_id, payload) VALUES ('${ORG_A}', 'A1'), ('${ORG_A}', 'A2'), ('${ORG_B}', 'B1')`,
    );

    // Plain counter table for the concurrent ledger test (no RLS needed).
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS "${COUNTER_TABLE}"`);
    await owner.$executeRawUnsafe(
      `CREATE TABLE "${COUNTER_TABLE}" (id int PRIMARY KEY, value int NOT NULL)`,
    );
    await owner.$executeRawUnsafe(`INSERT INTO "${COUNTER_TABLE}" (id, value) VALUES (1, 0)`);

    // Grant the app role just enough for the probe table and the function.
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE_NAME}`);
    await owner.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."${PROBE_TABLE}" TO ${APP_ROLE_NAME}`,
    );

    // The pre-context resolver function (§2.5). Idempotent — provisioned with the
    // same definition in CI. Owned by the owner role, runs SECURITY DEFINER.
    const existingFn = await owner.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_org_for_program') AS "exists"`,
    );
    createdAppOrgForProgram = !(existingFn[0]?.exists ?? false);
    await owner.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION public.app_org_for_program(p_program_id text)
       RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path = public, pg_temp
       AS $$ SELECT "organizationId" FROM public."Program" WHERE "id" = p_program_id $$`,
    );
    await owner.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION public.app_org_for_program(text) TO ${APP_ROLE_NAME}`,
    );

    // Seed organizations + a program for the resolver/injection tests.
    await owner.organization.upsert({
      where: { id: ORG_A },
      update: {},
      create: { id: ORG_A, name: "Org A" },
    });
    await owner.program.create({ data: { id: PROG_A, name: "Prog A", organizationId: ORG_A } });

    app = new PrismaClient({ datasources: { db: { url: appRoleUrlFrom(ownerUrl!) } } });
    enforceOwner = createTenantPrismaClient(owner, { mode: "enforce" });
    enforceApp = createTenantPrismaClient(app, { mode: "enforce" });
  });

  afterAll(async () => {
    await app?.$disconnect();
    await owner?.program.deleteMany({ where: { id: PROG_A } }).catch(() => undefined);
    await owner?.organization
      .deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } })
      .catch(() => undefined);
    if (createdAppOrgForProgram) {
      await owner
        ?.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.app_org_for_program(text)`)
        .catch(() => undefined);
    }
    await owner?.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`).catch(() => undefined);
    await owner
      ?.$executeRawUnsafe(`DROP TABLE IF EXISTS "${COUNTER_TABLE}"`)
      .catch(() => undefined);
    await owner?.$executeRawUnsafe(`DROP OWNED BY ${APP_ROLE_NAME}`).catch(() => undefined);
    await owner?.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP_ROLE_NAME}`).catch(() => undefined);
    await owner?.$disconnect();
  });

  describe("set_config placement (categories 1–2)", () => {
    it("sets the GUC once at the start of an interactive transaction, transaction-locally", async () => {
      const result = await runWithTenant({ organizationId: ORG_A }, () =>
        enforceOwner.$transaction(async (tx) => {
          const first = await tx.$queryRaw<{ setting: string | null }[]>(
            Prisma.sql`SELECT current_setting('app.organization_id', true) AS setting`,
          );
          const second = await tx.$queryRaw<{ setting: string | null }[]>(
            Prisma.sql`SELECT current_setting('app.organization_id', true) AS setting`,
          );
          return { first: first[0]?.setting ?? null, second: second[0]?.setting ?? null };
        }),
      );

      expect(result.first).toBe(ORG_A);
      expect(result.second).toBe(ORG_A);

      // `is_local = true` → cleared at commit. A reverted custom GUC reads back as
      // an empty string (or null on a fresh pooled connection), never the org id.
      const outside = await owner.$queryRawUnsafe<{ setting: string | null }[]>(
        `SELECT current_setting('app.organization_id', true) AS setting`,
      );
      expect(outside[0]?.setting ?? null).not.toBe(ORG_A);
    });

    it("wraps a loose $queryRaw as a batch transaction with context", async () => {
      const rows = await runWithTenant({ organizationId: ORG_A }, () =>
        enforceOwner.$queryRaw<{ setting: string }[]>(
          Prisma.sql`SELECT current_setting('app.organization_id', true) AS setting`,
        ),
      );
      expect(rows[0]?.setting).toBe(ORG_A);
    });

    it("wraps a loose $executeRaw with context", async () => {
      // The UPDATE only matches when the GUC is set to ORG_A inside the wrapped
      // raw statement — otherwise current_setting(..., true) is null and nothing
      // is affected.
      const affected = await runWithTenant({ organizationId: ORG_A }, () =>
        enforceOwner.$executeRaw(
          Prisma.sql`UPDATE "${Prisma.raw(COUNTER_TABLE)}" SET value = value WHERE id = 1 AND current_setting('app.organization_id', true) = ${ORG_A}`,
        ),
      );
      expect(affected).toBe(1);
    });
  });

  describe("RLS isolation (categories 3–4)", () => {
    it("isolates rows by tenant and does not leak across sequential requests", async () => {
      const orgA = await runWithTenant({ organizationId: ORG_A }, () =>
        enforceApp.$queryRaw<{ payload: string }[]>(
          Prisma.sql`SELECT payload FROM "${Prisma.raw(PROBE_TABLE)}" ORDER BY payload`,
        ),
      );
      const orgB = await runWithTenant({ organizationId: ORG_B }, () =>
        enforceApp.$queryRaw<{ payload: string }[]>(
          Prisma.sql`SELECT payload FROM "${Prisma.raw(PROBE_TABLE)}" ORDER BY payload`,
        ),
      );

      expect(orgA.map((r) => r.payload)).toEqual(["A1", "A2"]);
      expect(orgB.map((r) => r.payload)).toEqual(["B1"]);
    });

    it("raw SELECT … FOR UPDATE respects RLS", async () => {
      const rows = await runWithTenant({ organizationId: ORG_A }, () =>
        enforceApp.$queryRaw<{ payload: string }[]>(
          Prisma.sql`SELECT payload FROM "${Prisma.raw(PROBE_TABLE)}" FOR UPDATE`,
        ),
      );
      expect(rows.map((r) => r.payload).sort()).toEqual(["A1", "A2"]);
    });

    it("returns zero rows when the app role queries without context (RLS filters all)", async () => {
      // `$queryRawUnsafe` is not wrapped by the extension, so no set_config runs.
      const rows = await app.$queryRawUnsafe<{ payload: string }[]>(
        `SELECT payload FROM "${PROBE_TABLE}"`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("fail-visible missing context (category 5)", () => {
    it("throws TenantContextMissing under enforce for a tenant-scoped model", async () => {
      await expect(enforceOwner.member.findMany()).rejects.toBeInstanceOf(TenantContextMissing);
    });

    it("exempts global models under enforce", async () => {
      await expect(enforceOwner.organization.findMany()).resolves.toBeDefined();
    });

    it("invokes onMissingContext under audit without throwing", async () => {
      const onMissing = vi.fn();
      const audit = createTenantPrismaClient(owner, {
        mode: "audit",
        onMissingContext: onMissing,
      });
      const count = await audit.member.count();
      expect(count).toBeGreaterThanOrEqual(0);
      expect(onMissing).toHaveBeenCalledWith("Member", "count");
    });

    it("throws TenantContextMissing under enforce for an interactive transaction on a tenant model", async () => {
      // A worker (no request context) that opens a transaction over a tenant table
      // must fail loudly instead of silently reading zero rows under RLS.
      await expect(
        enforceOwner.$transaction(async (tx) => {
          await tx.member.findMany();
        }),
      ).rejects.toBeInstanceOf(TenantContextMissing);
    });

    it("allows an interactive transaction over global models without context under enforce", async () => {
      // e.g. the admin-login transaction, which touches only identity/tenant-root
      // tables before any tenant context exists.
      await expect(
        enforceOwner.$transaction(async (tx) => {
          await tx.adminUser.findMany();
          return tx.organization.count();
        }),
      ).resolves.toBeGreaterThanOrEqual(0);
    });

    it("invokes onMissingContext under audit for an interactive transaction on a tenant model", async () => {
      const onMissing = vi.fn();
      const audit = createTenantPrismaClient(owner, {
        mode: "audit",
        onMissingContext: onMissing,
      });
      const count = await audit.$transaction(async (tx) => tx.member.count());
      expect(count).toBeGreaterThanOrEqual(0);
      expect(onMissing).toHaveBeenCalledWith("Member", "count");
    });
  });

  describe("SECURITY DEFINER + concurrency (category 6)", () => {
    it("app_org_for_program returns only the org id and resists injection", async () => {
      const valid = await app.$queryRawUnsafe<{ org: string | null }[]>(
        `SELECT public.app_org_for_program($1) AS org`,
        PROG_A,
      );
      expect(valid[0]?.org).toBe(ORG_A);

      const malicious = await app.$queryRawUnsafe<{ org: string | null }[]>(
        `SELECT public.app_org_for_program($1) AS org`,
        "x' OR '1'='1",
      );
      expect(malicious[0]?.org ?? null).toBeNull();
    });

    it("resolveOrganizationId resolves via the SECURITY DEFINER function", async () => {
      await expect(resolveOrganizationId(app, PROG_A)).resolves.toBe(ORG_A);
    });

    it("runs 20 concurrent FOR UPDATE transactions without lost updates", async () => {
      await owner.$executeRawUnsafe(`UPDATE "${COUNTER_TABLE}" SET value = 0 WHERE id = 1`);

      await Promise.all(
        Array.from({ length: 20 }, () =>
          runWithTenant({ organizationId: ORG_A }, () =>
            enforceOwner.$transaction(async (tx) => {
              const rows = await tx.$queryRaw<{ value: number }[]>(
                Prisma.sql`SELECT value FROM "${Prisma.raw(COUNTER_TABLE)}" WHERE id = 1 FOR UPDATE`,
              );
              const next = (rows[0]?.value ?? 0) + 1;
              await tx.$executeRaw(
                Prisma.sql`UPDATE "${Prisma.raw(COUNTER_TABLE)}" SET value = ${next} WHERE id = 1`,
              );
            }),
          ),
        ),
      );

      const [{ value }] = await owner.$queryRawUnsafe<{ value: number }[]>(
        `SELECT value FROM "${COUNTER_TABLE}" WHERE id = 1`,
      );
      expect(value).toBe(20);
    });
  });
});

// Two-organization isolation against the real tenant tables
// (docs/design/tenancy.md §3.1, PR 5). Runs only when TEST_DATABASE_URL is set.
// It builds a scratch database (full schema), seeds two organizations × two
// programs, installs the generated RLS policies, and proves — through the
// least-privileged app role under `enforce` — that cross-org reads/writes are
// denied while same-org access is allowed. The scratch database is dropped at
// the end, so the shared CI database never has RLS enabled out from under the
// other (concurrent) test files.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTenantPrismaClient, runWithTenant } from "@loyaltyos/tenancy";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { enableRlsPolicies } from "../lib/provision-rls-policies.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === "true" && !databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required in CI (tenancy RLS tests must not be skipped)");
}

const SCRATCH_DB = "loyaltyos_test_rls";
const APP_ROLE_NAME = "tenancy_rls_app";
const APP_ROLE_PASSWORD = "tenancy_rls_app_pw";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..", "..");
const schemaPath = join(repoRoot, "apps", "api", "prisma", "schema.prisma");
const prismaBin = join(repoRoot, "apps", "api", "node_modules", ".bin", "prisma");

function scratchUrl(): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

function appRoleUrl(): string {
  const base = new URL(scratchUrl());
  return `${base.protocol}//${APP_ROLE_NAME}:${encodeURIComponent(APP_ROLE_PASSWORD)}@${base.host}${base.pathname}${base.search}`;
}

describe.skipIf(!databaseUrl)("tenancy RLS policies (PostgreSQL)", () => {
  let adminPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let enforceApp: PrismaClient;

  const suffix = Date.now().toString();
  const ORG_A = `org_rls_a_${suffix}`;
  const ORG_B = `org_rls_b_${suffix}`;
  const PROG_A = `prog_rls_a_${suffix}`;
  const PROG_B = `prog_rls_b_${suffix}`;
  const MEMBER_A = `m_rls_a_${suffix}`;
  const MEMBER_B = `m_rls_b_${suffix}`;

  beforeAll(async () => {
    adminPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    // Roles are cluster-wide, so drop any leftover from a prior (possibly failed)
    // run before recreating the scratch database and its grants.
    await adminPrisma
      .$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP_ROLE_NAME}`)
      .catch(() => undefined);
    await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);

    // Full schema into the scratch database.
    execSync(`"${prismaBin}" migrate deploy --schema "${schemaPath}"`, {
      env: { ...process.env, DATABASE_URL: scratchUrl() },
      stdio: "pipe",
    });

    const owner = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });

    // Least-privileged app role (superusers bypass RLS, so the isolation proof
    // must run through a NOBYPASSRLS role).
    await owner.$executeRawUnsafe(
      `CREATE ROLE ${APP_ROLE_NAME} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${APP_ROLE_PASSWORD}'`,
    );
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE_NAME}`);
    await owner.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE_NAME}`,
    );
    await owner.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE_NAME}`,
    );

    // Two organizations × two programs, one member each.
    await owner.organization.create({ data: { id: ORG_A, name: "Org A" } });
    await owner.organization.create({ data: { id: ORG_B, name: "Org B" } });
    await owner.program.create({ data: { id: PROG_A, name: "Prog A", organizationId: ORG_A } });
    await owner.program.create({ data: { id: PROG_B, name: "Prog B", organizationId: ORG_B } });
    await owner.member.create({
      data: { id: MEMBER_A, programId: PROG_A, organizationId: ORG_A },
    });
    await owner.member.create({
      data: { id: MEMBER_B, programId: PROG_B, organizationId: ORG_B },
    });

    // Install the generated RLS policies on every tenant table.
    await enableRlsPolicies(owner);
    await owner.$disconnect();

    appPrisma = new PrismaClient({ datasources: { db: { url: appRoleUrl() } } });
    enforceApp = createTenantPrismaClient(appPrisma, { mode: "enforce" });
  }, 60_000);

  afterAll(async () => {
    await appPrisma?.$disconnect();
    // Drop the scratch database first (removes its grants), then the cluster-wide
    // role it references.
    await adminPrisma
      ?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`)
      .catch(() => undefined);
    await adminPrisma
      ?.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP_ROLE_NAME}`)
      .catch(() => undefined);
    await adminPrisma?.$disconnect();
  }, 60_000);

  it("isolates reads by organization under enforce", async () => {
    const orgA = await runWithTenant({ organizationId: ORG_A }, () =>
      enforceApp.member.findMany({
        where: { programId: { in: [PROG_A, PROG_B] } },
        select: { id: true },
      }),
    );
    expect(orgA.map((m) => m.id).sort()).toEqual([MEMBER_A]);

    const orgB = await runWithTenant({ organizationId: ORG_B }, () =>
      enforceApp.member.findMany({
        where: { programId: { in: [PROG_A, PROG_B] } },
        select: { id: true },
      }),
    );
    expect(orgB.map((m) => m.id).sort()).toEqual([MEMBER_B]);
  });

  it("rejects a cross-organization write under enforce (WITH CHECK)", async () => {
    // The composite FK (programId, organizationId) → Program is satisfied (prog B
    // belongs to org B), so the only thing that can reject this INSERT is the RLS
    // WITH CHECK policy.
    await expect(
      runWithTenant({ organizationId: ORG_A }, () =>
        enforceApp.member.create({
          data: { programId: PROG_B, organizationId: ORG_B },
        }),
      ),
    ).rejects.toThrow(/row-level security|row level security/i);
  });

  it("allows a same-organization write under enforce", async () => {
    const id = `m_rls_created_${suffix}`;
    await runWithTenant({ organizationId: ORG_A }, () =>
      enforceApp.member.create({ data: { id, programId: PROG_A, organizationId: ORG_A } }),
    );

    // The new member is visible to org A and hidden from org B.
    const visible = await runWithTenant({ organizationId: ORG_A }, () =>
      enforceApp.member.findUnique({ where: { id }, select: { id: true } }),
    );
    expect(visible?.id).toBe(id);

    const hidden = await runWithTenant({ organizationId: ORG_B }, () =>
      enforceApp.member.findUnique({ where: { id }, select: { id: true } }),
    );
    expect(hidden).toBeNull();
  });

  it("returns zero rows for a tenant query with no context (RLS filters all)", async () => {
    // `$queryRawUnsafe` bypasses the extension, so no set_config runs and the
    // app role reads zero rows even though the rows exist.
    const rows = await appPrisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Member" WHERE "programId" IN ('${PROG_A}', '${PROG_B}')`,
    );
    expect(rows).toHaveLength(0);
  });
});

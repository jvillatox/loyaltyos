// Verifies the `add_point_lots` migration against a real v1.7.0 database with
// positive, zero, and negative balances. Runs only when TEST_DATABASE_URL is set.
//
// It builds a scratch database at the v1.7.0 schema (every migration except the
// new one), seeds v1.7.0-style data, applies the new migration, and asserts the
// lot/debt invariant holds on every account.
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI === "true" && !databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required in CI (database tests must not be skipped)");
}
const NEW_MIGRATION = "20261117092350_add_point_lots";
const SCRATCH_DB = "loyaltyos_test_mig";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..", "..");
const appsApi = join(repoRoot, "apps", "api");
const schemaPath = join(appsApi, "prisma", "schema.prisma");
const migrationsDir = join(appsApi, "prisma", "migrations");
const prismaBin = join(appsApi, "node_modules", ".bin", "prisma");

function scratchUrl(): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

describe.skipIf(!databaseUrl)("points expiry migration (v1.7.0 -> lots)", () => {
  let adminPrisma: PrismaClient;

  beforeAll(async () => {
    adminPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await adminPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    const cleanup = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await cleanup.$disconnect();
  });

  it("leaves the invariant valid on every account and preserves NONE expiry", async () => {
    // 1. A temp migrations folder holding every migration up to v1.7.0.
    const tmp = mkdtempSync(join(tmpdir(), "loyaltyos-mig-"));
    cpSync(schemaPath, join(tmp, "schema.prisma"));
    const tmpMigrations = join(tmp, "migrations");
    const isMigrationDir = (entry: string): boolean => /^\d{14}_/.test(entry);
    for (const entry of readdirSync(migrationsDir)) {
      // v1.7.0 = every migration before the lots migration. Later migrations
      // (tenancy, composite refs) reference PointLot, which only add_point_lots
      // creates, so they must be excluded from the pre-image too.
      if (isMigrationDir(entry) && entry >= NEW_MIGRATION) continue;
      cpSync(join(migrationsDir, entry), join(tmpMigrations, entry), { recursive: true });
    }

    const env = { ...process.env, DATABASE_URL: scratchUrl() };
    execSync(`"${prismaBin}" migrate deploy --schema "${join(tmp, "schema.prisma")}"`, {
      env,
      stdio: "pipe",
    });

    // 2. Seed v1.7.0-style data (no lots, no debt, no expiry columns yet).
    const prisma = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
    const seedStatements = [
      `INSERT INTO "Program" ("id", "name", "updatedAt") VALUES ('prog_mig', 'v170', NOW())`,
      `INSERT INTO "Member" ("id", "programId", "updatedAt") VALUES ('mem_pos', 'prog_mig', NOW())`,
      `INSERT INTO "Member" ("id", "programId", "updatedAt") VALUES ('mem_zero', 'prog_mig', NOW())`,
      `INSERT INTO "Member" ("id", "programId", "updatedAt") VALUES ('mem_neg', 'prog_mig', NOW())`,
      `INSERT INTO "PointAccount" ("id", "memberId", "programId", "balance", "updatedAt") VALUES ('acc_pos', 'mem_pos', 'prog_mig', 100, NOW())`,
      `INSERT INTO "PointAccount" ("id", "memberId", "programId", "balance", "updatedAt") VALUES ('acc_zero', 'mem_zero', 'prog_mig', 0, NOW())`,
      `INSERT INTO "PointAccount" ("id", "memberId", "programId", "balance", "updatedAt") VALUES ('acc_neg', 'mem_neg', 'prog_mig', -40, NOW())`,
      `INSERT INTO "PointTransaction" ("id", "accountId", "programId", "type", "amount", "balanceAfter", "source", "idempotencyKey", "settledAt", "createdAt") VALUES ('tx_earn', 'acc_pos', 'prog_mig', 'EARN', 100, 100, 'test', 'seed-earn', NOW(), NOW())`,
    ];
    for (const sql of seedStatements) {
      await prisma.$executeRawUnsafe(sql);
    }
    await prisma.$disconnect();

    // 3. Apply the new migration on top of the v1.7.0 data.
    execSync(`"${prismaBin}" migrate deploy --schema "${schemaPath}"`, { env, stdio: "pipe" });

    // 4. Verify the backfill produced a valid state. Lots are read directly rather
    // than through the PointAccount.lots relation: that relation is now a composite
    // one on (accountId, organizationId), and organizationId is still NULL here (this
    // test upgrades a v1.7.0 database but does not run the tenancy backfill), so an
    // `include: { lots: true }` join on organizationId would silently miss every lot.
    const verify = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });
    try {
      const accounts = await verify.pointAccount.findMany({
        where: { programId: "prog_mig" },
      });
      expect(accounts).toHaveLength(3);

      const lots = await verify.pointLot.findMany({ where: { programId: "prog_mig" } });
      const lotsByAccount = new Map<string, typeof lots>();
      for (const lot of lots) {
        const list = lotsByAccount.get(lot.accountId) ?? [];
        list.push(lot);
        lotsByAccount.set(lot.accountId, list);
      }

      for (const account of accounts) {
        const accountLots = lotsByAccount.get(account.id) ?? [];
        const totalRemaining = accountLots.reduce((sum, lot) => sum + lot.remaining, 0);
        expect(account.balance).toBe(totalRemaining - account.debt);
        if (account.debt > 0) expect(totalRemaining).toBe(0);
      }

      const positive = accounts.find((a) => a.id === "acc_pos");
      const zero = accounts.find((a) => a.id === "acc_zero");
      const negative = accounts.find((a) => a.id === "acc_neg");
      const positiveLots = lotsByAccount.get("acc_pos") ?? [];
      const zeroLots = lotsByAccount.get("acc_zero") ?? [];
      const negativeLots = lotsByAccount.get("acc_neg") ?? [];

      expect(positive!.balance).toBe(100);
      expect(positiveLots).toHaveLength(1);
      expect(positiveLots[0]!.remaining).toBe(100);
      expect(positiveLots[0]!.sourceTxId).toBeNull();
      expect(positiveLots[0]!.expiresAt).toBeNull();
      expect(positive!.lastActivityAt).not.toBeNull();

      expect(zero!.balance).toBe(0);
      expect(zeroLots).toHaveLength(0);
      expect(zero!.debt).toBe(0);

      expect(negative!.balance).toBe(-40);
      expect(negative!.debt).toBe(40);
      expect(negativeLots).toHaveLength(0);

      const program = await verify.program.findUniqueOrThrow({ where: { id: "prog_mig" } });
      expect(program.expiryMode).toBe("NONE");
    } finally {
      await verify.$disconnect();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

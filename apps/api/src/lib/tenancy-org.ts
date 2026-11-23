import { Prisma, PrismaClient } from "@prisma/client";

import { DEFAULT_ORG_ID, ensureDefaultOrganization } from "./tenancy-users.js";

// Backfill core for the expand → backfill → contract tenancy migration
// (docs/design/tenancy.md §4 step 2). The expand phase added a nullable
// `organizationId` to every §3.1 business table; this fills it from the default
// Organization so the composite FKs (§2.6) can be tightened to NOT NULL in the
// contract phase. Every UPDATE is guarded by `WHERE "organizationId" IS NULL`, so
// the backfill is idempotent, and it is batched so it can be interrupted and
// resumed on large tables (PointTransaction).

export type TenantDb = PrismaClient | Prisma.TransactionClient;

export const BACKFILL_BATCH_SIZE = 10_000;

// §3.1 tables that carry `programId`. `organizationId` is derived by joining to
// Program and is locked to it by the composite FK `(programId, organizationId) →
// Program(id, organizationId)`. Listed in the migration's cascade/restrict order.
export const PROGRAM_TABLES = [
  "PointRule",
  "Tier",
  "Campaign",
  "Segment",
  "Coupon",
  "Reward",
  "Badge",
  "NotificationTemplate",
  "WebhookSubscription",
  "MemberDevice",
  "MemberNotificationPreferences",
  "TermsTemplate",
  "Event",
  "Member",
  "PointAccount",
  "PointTransaction",
  "PointLot",
  "PointExpiryReminder",
  "PointAdjustmentRequest",
  "GiftCardBatch",
  "GiftCardTransaction",
  "CoalitionConfig",
  "CoalitionAccount",
  "CoalitionTransaction",
  "AuditLog",
] as const;

// §3.1 child tables that lack `programId`. Each derives `organizationId` from its
// parent (which is itself a `programId` table) and is kept consistent by a composite
// FK against that parent. CampaignVariant is included even though §3.1's prose omits
// it — the composite FK in the migration covers it.
export const PARENT_CHILD_TABLES = [
  { table: "MemberTier", parentColumn: "memberId", parentTable: "Member" },
  { table: "CampaignVariant", parentColumn: "campaignId", parentTable: "Campaign" },
  { table: "CampaignApplication", parentColumn: "campaignId", parentTable: "Campaign" },
  { table: "Notification", parentColumn: "memberId", parentTable: "Member" },
  { table: "CouponRedemption", parentColumn: "couponId", parentTable: "Coupon" },
  { table: "GiftCard", parentColumn: "batchId", parentTable: "GiftCardBatch" },
  { table: "MemberBadge", parentColumn: "badgeId", parentTable: "Badge" },
  { table: "RewardRedemption", parentColumn: "rewardId", parentTable: "Reward" },
] as const;

// Interpolate a hardcoded identifier as raw SQL. Every name passed here comes from
// the constants above, never from user input, so this is not an injection vector.
const ident = (name: string): Prisma.Sql => Prisma.raw(`"${name}"`);

export interface BackfillOrganizationResult {
  organizationId: string;
  programCount: number;
  tableCounts: Record<string, number>;
}

// Updates one table in batches of BACKFILL_BATCH_SIZE, joining each null-`organizationId`
// row to a source alias `s` that exposes `s."organizationId"`. The inner join only
// matches rows whose source exists, so any orphan row (impossible under the existing
// single-column `programId` FKs, but see the five relation-less tables) is simply left
// NULL and surfaced by the contract phase rather than looping forever.
async function backfillTableFromSource(
  db: TenantDb,
  tableName: string,
  sourceJoin: Prisma.Sql,
): Promise<number> {
  let total = 0;
  for (;;) {
    const affected = await db.$executeRaw`
      WITH target AS (
        SELECT t.ctid AS ctid, s."organizationId" AS "organizationId"
        FROM ${ident(tableName)} AS t
        ${sourceJoin}
        WHERE t."organizationId" IS NULL
        LIMIT ${BACKFILL_BATCH_SIZE}
      )
      UPDATE ${ident(tableName)} AS t
      SET "organizationId" = target."organizationId"
      FROM target
      WHERE t.ctid = target.ctid
    `;
    total += affected;
    if (affected < BACKFILL_BATCH_SIZE) {
      break;
    }
  }
  return total;
}

const programSource = Prisma.sql`JOIN "Program" AS s ON t."programId" = s."id"`;

function parentSource(parentTable: string, parentColumn: string): Prisma.Sql {
  return Prisma.sql`JOIN ${ident(parentTable)} AS s ON t.${ident(parentColumn)} = s."id"`;
}

async function countNulls(db: TenantDb, tableName: string): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM ${ident(tableName)} WHERE "organizationId" IS NULL
  `;
  return rows[0]?.count ?? 0;
}

// Fills `organizationId` on Program and every §3.1 table from the default
// Organization. With `dryRun` it reports the per-table NULL counts without writing.
// Callers that want atomicity wrap this in a `$transaction`.
export async function backfillOrganizationColumns(
  db: TenantDb,
  options: { dryRun?: boolean } = {},
): Promise<BackfillOrganizationResult> {
  const organizationId = options.dryRun ? DEFAULT_ORG_ID : (await ensureDefaultOrganization(db)).id;

  if (options.dryRun) {
    const programCount = await countNulls(db, "Program");
    const tableCounts: Record<string, number> = { Program: programCount };
    for (const table of PROGRAM_TABLES) {
      tableCounts[table] = await countNulls(db, table);
    }
    for (const { table } of PARENT_CHILD_TABLES) {
      tableCounts[table] = await countNulls(db, table);
    }
    return { organizationId, programCount, tableCounts };
  }

  const programCount = await db.$executeRaw`
    UPDATE "Program" SET "organizationId" = ${organizationId} WHERE "organizationId" IS NULL
  `;

  const tableCounts: Record<string, number> = {};
  for (const table of PROGRAM_TABLES) {
    tableCounts[table] = await backfillTableFromSource(db, table, programSource);
  }
  for (const { table, parentColumn, parentTable } of PARENT_CHILD_TABLES) {
    tableCounts[table] = await backfillTableFromSource(
      db,
      table,
      parentSource(parentTable, parentColumn),
    );
  }

  return { organizationId, programCount, tableCounts };
}

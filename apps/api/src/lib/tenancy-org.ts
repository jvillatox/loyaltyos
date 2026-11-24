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

// Interpolate a hardcoded identifier as raw SQL. Every name passed here comes from
// the constants below, never from user input, so this is not an injection vector.
const ident = (name: string): Prisma.Sql => Prisma.raw(`"${name}"`);

// Every §3.1 table and how it derives `organizationId`. A `program` table carries
// `programId` and derives it from Program; a `parent` table lacks `programId` and
// derives it from its parent row. The array is in topological order: a table must
// be backfilled only after every table its composite FK references. Unlike
// tenancy:move-program (which rewrites everything in one transaction and relies on
// the DEFERRABLE INITIALLY DEFERRED checks firing at a single COMMIT), the backfill
// commits per table to stay resumable on large tables — so a child whose parent is
// still NULL fails immediately, and the order here is what keeps it valid.
type BackfillEntry =
  | { table: string; source: "program" }
  | { table: string; source: "parent"; parentTable: string; parentColumn: string };

const BACKFILL_ORDER: readonly BackfillEntry[] = [
  // Level 1 — reference only Program (programId → Program).
  { table: "PointRule", source: "program" },
  { table: "Tier", source: "program" },
  { table: "Campaign", source: "program" },
  { table: "Segment", source: "program" },
  { table: "Coupon", source: "program" },
  { table: "Reward", source: "program" },
  { table: "Badge", source: "program" },
  { table: "NotificationTemplate", source: "program" },
  { table: "WebhookSubscription", source: "program" },
  { table: "TermsTemplate", source: "program" },
  { table: "CoalitionConfig", source: "program" },
  { table: "Member", source: "program" },
  { table: "AuditLog", source: "program" },
  { table: "PointExpiryReminder", source: "program" },

  // Level 2 — reference Member (and, for the parent tables, another level-1 table).
  { table: "MemberDevice", source: "program" },
  { table: "MemberNotificationPreferences", source: "program" },
  { table: "Event", source: "program" },
  { table: "PointAccount", source: "program" },
  { table: "PointAdjustmentRequest", source: "program" },
  { table: "CoalitionAccount", source: "program" },
  { table: "GiftCardBatch", source: "program" }, // → TermsTemplate (level 1)
  { table: "MemberTier", source: "parent", parentTable: "Member", parentColumn: "memberId" },
  {
    table: "CampaignVariant",
    source: "parent",
    parentTable: "Campaign",
    parentColumn: "campaignId",
  },
  { table: "Notification", source: "parent", parentTable: "Member", parentColumn: "memberId" },
  { table: "CouponRedemption", source: "parent", parentTable: "Coupon", parentColumn: "couponId" },
  { table: "MemberBadge", source: "parent", parentTable: "Badge", parentColumn: "badgeId" },
  { table: "RewardRedemption", source: "parent", parentTable: "Reward", parentColumn: "rewardId" },

  // Level 3 — reference a level-2 table.
  { table: "PointTransaction", source: "program" }, // → PointAccount
  { table: "PointLot", source: "program" }, // → PointAccount
  { table: "CoalitionTransaction", source: "program" }, // → CoalitionAccount
  {
    table: "CampaignApplication",
    source: "parent",
    parentTable: "Campaign",
    parentColumn: "campaignId",
  }, // → CampaignVariant
  { table: "GiftCard", source: "parent", parentTable: "GiftCardBatch", parentColumn: "batchId" },

  // Level 4 — references GiftCard (level 3) and Member (level 1).
  { table: "GiftCardTransaction", source: "program" },
];

// Two projections used by tenancy:move-program, which rewrites every table in one
// transaction and therefore does not depend on ordering.
export const PROGRAM_TABLES: readonly string[] = BACKFILL_ORDER.filter(
  (entry) => entry.source === "program",
).map((entry) => entry.table);

const isParentEntry = (
  entry: BackfillEntry,
): entry is Extract<BackfillEntry, { source: "parent" }> => entry.source === "parent";

export const PARENT_CHILD_TABLES: readonly {
  table: string;
  parentColumn: string;
  parentTable: string;
}[] = BACKFILL_ORDER.filter(isParentEntry).map((entry) => ({
  table: entry.table,
  parentColumn: entry.parentColumn,
  parentTable: entry.parentTable,
}));

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
    for (const { table } of BACKFILL_ORDER) {
      tableCounts[table] = await countNulls(db, table);
    }
    return { organizationId, programCount, tableCounts };
  }

  const programCount = await db.$executeRaw`
    UPDATE "Program" SET "organizationId" = ${organizationId} WHERE "organizationId" IS NULL
  `;

  const tableCounts: Record<string, number> = {};
  for (const entry of BACKFILL_ORDER) {
    const sourceJoin =
      entry.source === "program"
        ? programSource
        : parentSource(entry.parentTable, entry.parentColumn);
    tableCounts[entry.table] = await backfillTableFromSource(db, entry.table, sourceJoin);
  }

  return { organizationId, programCount, tableCounts };
}

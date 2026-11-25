import type { TenantRlsMode } from "@loyaltyos/tenancy";
import type { PrismaClient } from "@prisma/client";

export type ProvisionDb = Pick<PrismaClient, "$executeRawUnsafe">;

// The §3.1 tenant tables (docs/design/tenancy.md), in Prisma model (PascalCase)
// form — the SQL table name when no @@map is set. `Program` is the derivation
// root but is itself tenant-scoped. Global tables (§3.2) are absent; they are
// read before tenant context exists and must not be RLS-locked.
export const TENANT_TABLES: readonly string[] = [
  "Program",
  "Member",
  "PointAccount",
  "PointTransaction",
  "PointLot",
  "PointExpiryReminder",
  "PointAdjustmentRequest",
  "PointRule",
  "Tier",
  "MemberTier",
  "Campaign",
  "CampaignVariant",
  "CampaignApplication",
  "Segment",
  "Coupon",
  "CouponRedemption",
  "TermsTemplate",
  "GiftCardBatch",
  "GiftCard",
  "GiftCardTransaction",
  "Reward",
  "RewardRedemption",
  "Badge",
  "MemberBadge",
  "NotificationTemplate",
  "Notification",
  "CoalitionConfig",
  "CoalitionAccount",
  "CoalitionTransaction",
  "WebhookSubscription",
  "AuditLog",
  "MemberDevice",
  "MemberNotificationPreferences",
  "Event",
];

export const RLS_POLICY_NAME = "tenancy_org_isolation";

// A row is visible/mutable only when its organizationId equals the
// transaction-local GUC set by the tenancy extension (§2.2). When the GUC is
// unset, current_setting(..., true) is NULL, so the predicate is NULL and the
// row is filtered out — "no context → zero rows".
const PREDICATE = `"organizationId" = current_setting('app.organization_id', true)::text`;

// Installs FORCE ROW LEVEL SECURITY + an org-isolation policy on every tenant
// table. Idempotent (DROP POLICY IF EXISTS before CREATE). Runs as the owner.
export async function enableRlsPolicies(db: ProvisionDb): Promise<void> {
  for (const table of TENANT_TABLES) {
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await db.$executeRawUnsafe(`DROP POLICY IF EXISTS ${RLS_POLICY_NAME} ON "${table}"`);
    await db.$executeRawUnsafe(
      `CREATE POLICY ${RLS_POLICY_NAME} ON "${table}" ` +
        `USING (${PREDICATE}) WITH CHECK (${PREDICATE})`,
    );
  }
}

// Reverts enableRlsPolicies: drops the policy and disables RLS on every tenant
// table. This is how `TENANCY_RLS=off` stays behaviorally identical to an
// un-extended client (no context, no filtering).
export async function disableRlsPolicies(db: ProvisionDb): Promise<void> {
  for (const table of TENANT_TABLES) {
    await db.$executeRawUnsafe(`DROP POLICY IF EXISTS ${RLS_POLICY_NAME} ON "${table}"`);
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }
}

// Reconciler used by the provisioning script: `off` drops the policies so the
// app role reads across the tenant boundary, `audit`/`enforce` installs them.
export async function provisionRlsPolicies(db: ProvisionDb, mode: TenantRlsMode): Promise<void> {
  if (mode === "off") {
    await disableRlsPolicies(db);
  } else {
    await enableRlsPolicies(db);
  }
}

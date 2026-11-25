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

// Gate for `TENANCY_RLS=enforce`: the worker sweeps (expiry, reminders,
// settlement, reconciliation, token cleanup) must be org-scoped first, because
// they query tenant tables with no context. Under RLS they would silently read
// zero rows / fail WITH CHECK. PR 11 flips this to `true` once the sweeps list
// orgs via `app_list_organization_ids()` and process per-org under the app role.
export const WORKER_SWEEPS_ORG_SCOPED = false;

// Refuses to provision `enforce` until the sweeps are org-scoped. Kept as a pure
// decision (like `evaluateDbRoleGuard`) so it is unit-testable; the flag is the
// one PR 11 changes.
export function assertEnforceReady(sweepsOrgScoped: boolean): void {
  if (sweepsOrgScoped) return;
  throw new Error(
    "Refusing to provision TENANCY_RLS=enforce: worker sweeps are not yet " +
      "org-scoped (PR 11). Enabling RLS now would silently break them. Flip " +
      "WORKER_SWEEPS_ORG_SCOPED in provision-rls-policies.ts once PR 11 lands, " +
      "or use TENANCY_RLS=audit.",
  );
}

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

// Reconciler used by the provisioning script (docs/design/tenancy.md §4 step 3).
// Postgres cannot "log-only" a denied row — a policy either filters the row or
// lets it through — so only `enforce` installs the policies. `audit` and `off`
// are identical at the database level (no policies): `audit` observes
// missing-context queries at the application layer (warn + metric) while the DB
// still returns data. That keeps the not-yet-org-scoped worker sweeps working
// until PR 11 lands, instead of silently reading zero rows.
export async function provisionRlsPolicies(db: ProvisionDb, mode: TenantRlsMode): Promise<void> {
  if (mode === "enforce") {
    await enableRlsPolicies(db);
  } else {
    await disableRlsPolicies(db);
  }
}

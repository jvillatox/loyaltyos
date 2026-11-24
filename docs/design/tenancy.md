# Multi-tenant foundation (tenancy) — Design

> Status: **Design only**. No code has been written yet. This document is the
> review artifact for M1 (tenancy) of the Cloud plan and is scoped strictly to
> the open-source core. It must behave identically in a single-program
> self-hosted install: no partners, funding, or commercial Cloud data belong in
> this repository or in this design.

## Summary

LoyaltyOS currently isolates data with a single column, `programId`, derived from
the authenticated credential (`admin`/`member`/PAT/member-token/API key). M1
introduces an explicit tenant root — **`Organization`** — and makes it the hard
database isolation boundary with **PostgreSQL Row-Level Security (RLS)**.
`Program` stays the application-level scope, exactly as today.

Two decisions shape everything:

1. **No `Tenant` entity in the core.** The Cloud plan inserts a `Tenant` between
   `Organization` and `Program` as a "billable service account / isolation key".
   That is a commercial, Cloud-only concern (billing, sandbox-vs-live
   provisioning). In the open-source core the organization _is_ the isolation
   boundary; a self-hoster with one program is one organization. A multi-brand or
   multi-environment business maps naturally to multiple `Program`s under one
   `Organization`. Cloud may add its own `tenant`/`cloud_*` tables later without
   touching the core's isolation column.
2. **`organizationId` is the RLS column**, denormalized onto every business table
   (the same pattern `programId` already follows) and kept consistent by a
   composite foreign key `(programId, organizationId) → Program`. `programId`
   remains for defense-in-depth and for per-member/program scope.

Roles stay `SUPER_ADMIN` / `OPERATOR` / `ANALYST`. Renaming them to
`BUSINESS_OWNER`/`BUSINESS_MANAGER`/`BUSINESS_ANALYST` is cosmetic churn for
self-hosters and is left to Cloud; the `@loyaltyos/permissions` map and the
admin UI are untouched by the naming.

The security posture is explicit rather than implicit:

- **Two DB URLs.** `DATABASE_URL` (role `loyaltyos_app`, `NOSUPERUSER
NOBYPASSRLS`) for the API and workers; `MIGRATION_DATABASE_URL` (owner) for
  migrations and scripts. A boot guard refuses to start on a superuser/BYPASSRLS
  connection under `audit`/`enforce`.
- **Fail visible.** A query with no tenant context throws `TenantContextMissing`
  in `enforce` mode (logs + counts in `audit`), except the listed global tables.
- **Pre-context resolution.** Entry points that only know a `programId` (member
  login, magic link, widget, `/auth/*`) resolve the organization through a
  scoped `SECURITY DEFINER` function, never by reading `Program` without context.

The migration is **expand → backfill → contract**: additive and reversible at
every step, with a single default `Organization` for existing installs and
`AdminUser` evolving to `User` + `OrganizationMembership`.

MFA (TOTP) is **out of scope for M1**; it ships with the Cloud platform roles.

---

## 1. Model

### 1.1 `Organization` → `Program`

```prisma
model Organization {
  id          String   @id @default(cuid())
  name        String
  status      OrgStatus @default(ACTIVE)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  programs    Program[]
  memberships OrganizationMembership[]
}

enum OrgStatus {
  ACTIVE
  SUSPENDED
  CLOSED
}
```

`Organization` is deliberately minimal. `type` (`BUSINESS`/`PARTNER`/`PLATFORM`),
`legalName`, `country`, `locale`, `timezone`, `slug`, billing and contract fields
are commercial and belong to Cloud; adding them here would pollute the MIT core.

`Program` gains one column plus an FK-target unique:

```prisma
model Program {
  // … existing fields unchanged …
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)

  @@index([organizationId])
  @@unique([id, organizationId]) // FK target for the composite child FKs (§2.6)
}
```

### 1.2 `User` + `OrganizationMembership` replace `AdminUser`

`AdminUser` today is `programId`-scoped with a **globally unique** `email`. A
person who administers two programs is currently two `AdminUser` rows with two
emails. The new model splits identity from access:

```prisma
enum UserStatus {
  ACTIVE
  DISABLED
}

model User {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String?
  name         String
  status       UserStatus @default(ACTIVE)
  locale       String     @default("es-MX")
  lastLoginAt  DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  memberships            OrganizationMembership[]
  adminSessions          AdminSession[]
  personalAccessTokens   PersonalAccessToken[]
  giftCardBatches        GiftCardBatch[]
  auditLogs              AuditLog[]
}

enum MembershipStatus {
  INVITED
  ACTIVE
  DISABLED
}

model OrganizationMembership {
  id             String           @id @default(cuid())
  userId         String
  organizationId String
  role           AdminRole        @default(OPERATOR)   // SUPER_ADMIN | OPERATOR | ANALYST
  programIds     String[]         @default([])         // optional scope; empty = whole org
  status         MembershipStatus @default(ACTIVE)
  invitedById    String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId, status])
}
```

The **role** moves from `User` to the membership: the same person can be
`SUPER_ADMIN` in organization A and `ANALYST` in organization B. The effective
role of a request is the role of the user's **active** membership in the
request's organization.

There is no `mfaSecretEnc` column here: MFA (TOTP) is out of scope for M1 and
arrives with the Cloud platform roles.

### 1.3 Relationship to the existing auth surface

| Existing concept                  | Today (v1.9.2)                                                                                                                                                      | After M1                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin session                     | `AdminSession.userId → AdminUser`; role from `AdminUser.role`                                                                                                       | `AdminSession.userId → User`; session carries `activeMembershipId` (or `activeOrganizationId`) so a multi-org user's org choice survives the cookie             |
| Personal access token (`lopat_…`) | `PersonalAccessToken.adminUserId → AdminUser`; already hashed (`tokenHash` + `prefix`); `role` stamped on the token; effective role = `min(token.role, owner.role)` | `PersonalAccessToken.membershipId → OrganizationMembership` (implies `userId` + `organizationId` + `role`); effective role = `min(token.role, membership.role)` |
| API key (`X-API-Key`)             | `ApiKey.programId` + `scope` (`SERVER`/`CLIENT`); **plaintext `key`**                                                                                               | `ApiKey.organizationId` + `keyHash` + `prefix` (hashed; see §7)                                                                                                 |
| Member session token (`lomem_…`)  | `MemberSessionToken.memberId` + `programId`, hashed                                                                                                                 | unchanged shape; org is derived `member.program.organizationId`                                                                                                 |
| Member session / magic link       | `Session.userId → Member`, `MagicLinkToken.memberId`                                                                                                                | unchanged; member identity stays a separate domain (never mixed with `User`)                                                                                    |
| `AuditLog`                        | `programId`, `adminUserId → AdminUser`, `actorType`/`actorId`                                                                                                       | `organizationId` added; `adminUserId → User`; `actorType`/`actorId` unchanged (already generic)                                                                 |
| RBAC                              | `can(role, permission)` over `AdminUser.role`                                                                                                                       | same `@loyaltyos/permissions` map and `can()`, but `role` comes from the active membership                                                                      |

Nothing in the **member** domain (`Member`, `Session`, `MemberSessionToken`,
`MagicLinkToken`, portal/widget) changes shape; those already resolve to a
`programId`, which now implies an `organizationId`.

---

## 2. Database isolation (Postgres RLS)

### 2.1 The isolation column

`organizationId`, denormalized onto every business table, is the RLS column.
Rationale:

- **Organization is the tenant boundary.** Cloud may put many programs under one
  organization; cross-program reads within an org are legitimate, cross-org reads
  never are. `programId` is too fine a boundary and would break in-org analytics.
- **Consistent with the existing pattern.** `programId` is already denormalized
  onto ~30 tables; denormalizing `organizationId` the same way keeps every policy
  a trivial, indexable predicate instead of a subquery through `Program` (which
  would be slow and would still need a join chain for the ~11 child tables that
  lack `programId`).
- **`programId` remains for defense-in-depth.** The app keeps filtering by
  `request.programId`; RLS is the outer hard boundary, `programId` the inner one.
  A self-hosted multi-program install keeps its existing program isolation even
  though all its programs share one organization.
- **The two columns cannot diverge** — every `programId` table carries a
  composite FK `(programId, organizationId) → Program(id, organizationId)`
  (§2.6), so a row's `organizationId` is always its program's `organizationId`.

### 2.2 Setting context without per-query interactive transactions

The context is a transaction-local Postgres GUC:

```sql
SELECT set_config('app.organization_id', $1, /* is_local */ true);
```

`is_local = true` makes it equivalent to `SET LOCAL`: it lives only for the
current transaction and is discarded at commit/rollback. That is what makes it
safe with a connection pool — a pooled connection never leaks one tenant's
context into the next request.

**We do not open an interactive transaction per query.** That would collide with
the ledger's `$transaction(… SELECT … FOR UPDATE …)` blocks (Prisma does not nest
interactive transactions) and would add a round-trip per query. Instead the
context is applied in three shapes, all through one `withTenantContext` helper:

1. **Inside an existing `$transaction`:** the extension wraps
   `prisma.$transaction` so its first statement is `set_config(…, true)`; every
   statement in the block inherits the GUC. One `set_config` per transaction, and
   `FOR UPDATE` inside it is unaffected.
2. **A loose query outside any transaction:** wrapped as a batch —
   `prisma.$transaction([$executeRaw set_config, query])` — so the query runs in
   its own transaction with context.
3. **`$queryRaw` / `$executeRaw`:** `$allModels` does not intercept raw queries,
   so the same helper wraps them explicitly; raw SQL carries context exactly like
   model queries.

Implementation shape (in the new `packages/tenancy`):

```ts
// AsyncLocalStorage carries the current tenant through the request/job.
export interface TenantContext {
  organizationId: string;
  programId?: string;
}

const GLOBAL_MODELS = new Set([
  /* the §3.2 tables */
]);

const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, args, query }) {
        const ctx = tenantStorage.getStore();
        if (!ctx) {
          if (GLOBAL_MODELS.has(model)) return query(args);
          if (rlpMode === "enforce") throw new TenantContextMissing(model);
          auditNoContext(model); // audit: log + metric, then RLS returns zero rows
        }
        return withTenantContext(ctx, () => query(args));
      },
    },
    async $transaction(args) {
      // wrap: issue set_config once at the start of the transaction
      // so all statements inside inherit the GUC.
    },
  },
});
```

The Fastify `preHandler` derives the context from the authenticated credential
and runs the handler inside `tenantStorage.run(ctx, …)`.

**Fail visible.** Under `TENANCY_RLS=enforce`, a query with no context on a
non-global model throws `TenantContextMissing` at the application layer — the DB
would silently return zero rows under RLS, so the extension turns a silent empty
result into a loud bug. Under `audit`, the extension logs the operation and
increments a counter so missing-context hotspots are measured before flipping to
`enforce`. Global tables (§3.2) are exempt.

### 2.3 Database roles and two connection URLs

Docker Compose and Helm create `POSTGRES_USER` as a superuser, which bypasses RLS
even under `FORCE ROW LEVEL SECURITY`. The runtime must never connect as a
superuser.

| URL                      | Role            | Attributes                                                                                  | Used by                                   |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `DATABASE_URL`           | `loyaltyos_app` | `NOSUPERUSER NOBYPASSRLS`; `SELECT/INSERT/UPDATE/DELETE` on business tables; `USAGE` on seq | the API runtime and BullMQ workers        |
| `MIGRATION_DATABASE_URL` | `owner`         | owns tables, full DDL; needs `CREATEROLE` to run provisioning                               | `prisma migrate deploy`, backfill/scripts |

A migration/script provisions the app role and its grants (idempotent), and
`docker-compose.yml`, the Helm values and `.env.example` are updated to wire both
URLs.

**No `BYPASSRLS` runtime role.** Creating a `BYPASSRLS` role requires superuser,
which the managed-Postgres owner (RDS, Cloud SQL, Azure) does not have — so
provisioning would fail exactly where Cloud runs. Instead, a `SECURITY DEFINER`
function owned by the migration owner replaces the old `loyaltyos_platform` role
for the one privileged listing worker sweeps need:

```sql
CREATE OR REPLACE FUNCTION public.app_list_organization_ids()
RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT id FROM public."Organization" ORDER BY id;
END
$$;

GRANT EXECUTE ON FUNCTION public.app_list_organization_ids() TO loyaltyos_app;
```

It runs as its owner (which owns the tables) and returns **only** organization
ids.

**Provisioning requires `CREATEROLE`.** The provisioning script issues
`CREATE ROLE`, so the `MIGRATION_DATABASE_URL` owner must have `CREATEROLE` (a
plain DB owner does). On managed Postgres the provisioned admin may not; in that
case a DBA runs the equivalent SQL once by hand and `LOYALTYOS_APP_DB_PASSWORD`
is left unset so provisioning skips:

```sql
CREATE ROLE loyaltyos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<password>';
GRANT USAGE ON SCHEMA public TO loyaltyos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO loyaltyos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO loyaltyos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO loyaltyos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO loyaltyos_app;
```

`ALTER TABLE … FORCE ROW LEVEL SECURITY` is applied to every tenant table so that
even the table owner is subject to the policy (only superusers are exempt). The
`app.organization_id` GUC is a plain text GUC, so it is not itself a security
control against a compromised DB role — it is a guardrail for correct application
code. That is why `BYPASSRLS` is confined to the owner role and the
boot guard below.

**Boot guard.** With `TENANCY_RLS=audit|enforce`, the API refuses to start if the
connection's `current_user` is a superuser or has `BYPASSRLS`:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

If either is true the API logs a clear message ("refusing to start:
`DATABASE_URL` connects as a superuser/BYPASSRLS role; use `loyaltyos_app`") and
exits non-zero. A test asserts the guard.

### 2.4 Connection pool, workers, scripts, migrations

- **Connection pool:** safe — `set_config(…, true)` is transaction-local. No
  per-tenant pooling or connection pinning is required.
- **BullMQ workers / sweeps (no request):** expiry, reminders, settlement,
  reconciliation, token cleanup. Each sweep runs in two phases: (1) list
  organizations via `app_list_organization_ids()` — the owner's `SECURITY DEFINER`
  function, the **only** privileged listing; (2) for each organization, run the
  per-org work inside `tenantStorage.run(ctx)` under the **app role**. No
  `BYPASSRLS` runtime role exists, and the function returns only ids.
- **Scripts** (`admin:create`, `admin:token:*`, `coalition:reencrypt`,
  `tenancy:backfill`, `tenancy:move-program`): administrative, cross-tenant →
  run under the owner role, not the app role.
- **Migrations:** run under the owner role. With `FORCE RLS` and no context, a
  backfill `UPDATE` under the app role would match zero rows.

### 2.5 Resolving program → organization before context

Several entry points run before a session or credential has established tenant
context: member login, magic-link validation, widget calls carrying only
`X-Program-Id`, and the `/auth/*` routes. They know a `programId` and must derive
`organizationId` to establish context — but `Program` is RLS-scoped, so reading
it with no context returns zero rows (or throws).

The answer is a narrowly-scoped `SECURITY DEFINER` function owned by the owner
role, returning **only** the `organizationId`:

```sql
CREATE FUNCTION app_org_for_program(p_program_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT "organizationId" FROM "Program" WHERE id = p_program_id $$;
```

Because it is `SECURITY DEFINER` (runs as its owner, which has `BYPASSRLS`), it
can read `Program` without context; because it returns only the `organizationId`,
it leaks nothing else. An optional short-TTL application cache in front of it
removes the round-trip on hot paths.

Entry points that use it (each documented and tested):

| Entry point                              | Input                      | How it resolves the organization                                                      |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| Member login (`POST /auth/member/login`) | `programId` + credentials  | `app_org_for_program(programId)` → context                                            |
| Magic link (`MagicLinkToken`)            | opaque token               | token lookup is global (§3.2); then `app_org_for_program(member.programId)` → context |
| Widget (`X-Program-Id`)                  | `programId` header         | `app_org_for_program(programId)` → context                                            |
| Other `/auth/*` routes                   | `programId` in header/body | `app_org_for_program(programId)` → context                                            |

### 2.6 Consistency: composite foreign key

Every table that has `programId` also gets `organizationId`, and the two are kept
in lock-step by a composite foreign key referencing `Program(id, organizationId)`:

```prisma
model Program {
  id             String   @id @default(cuid())
  organizationId String
  // …
  @@unique([id, organizationId]) // FK target
}

model PointTransaction {
  programId      String
  organizationId String
  program        Program @relation(fields: [programId, organizationId], references: [id, organizationId], onDelete: Restrict)
  // …
}
```

This makes it structurally impossible for a row's `organizationId` to diverge
from its `Program.organizationId`. The `@@unique([id, organizationId])` on
`Program` is required by Postgres as the FK target (technically redundant with
the primary key, but harmless).

The same pattern extends to **business-table references** — a child row may only
reference a parent in the same organization. Every reference between §3.1 tables
(`PointTransaction.accountId → PointAccount`, `MemberTier.tierId → Tier`,
`CampaignApplication.variantId → CampaignVariant`, `CouponRedemption.memberId →
Member`, `RewardRedemption.memberId → Member`, `CoalitionAccount.memberId →
Member`, `CoalitionTransaction.accountId → CoalitionAccount`,
`GiftCardBatch.termsTemplateId → TermsTemplate`, `GiftCardTransaction.giftCardId →
GiftCard`, `PointAccount.memberId → Member`, `PointAdjustmentRequest.memberId →
Member`, `PointLot.accountId → PointAccount`, and the four SetNull edges below)
gets a composite FK `(X_id, organizationId) → X(id, organizationId)`; each
referenced table carries `@@unique([id, organizationId])` as the target.

**SetNull references** are the exception. `Event.memberId`, `GiftCardTransaction
.memberId`, `CampaignApplication.variantId` and `Notification.templateId` are
optional and declared `onDelete: SetNull`. A composite FK with `ON DELETE SET
NULL` would also null `organizationId`, and PostgreSQL 14 has no
`SET NULL (columns)` (that lands in 15). Instead each SetNull edge uses:

1. a composite FK `(X_id, organizationId) → X(id, organizationId)` with
   `ON DELETE NO ACTION … DEFERRABLE INITIALLY DEFERRED` for the cross-org
   guarantee, and
2. a `BEFORE DELETE` trigger on the parent that sets only the FK column to
   `NULL`, leaving `organizationId` intact.

The trigger runs before the deferred `NO ACTION` check, so deleting a parent with
children neither nulls their org nor trips the constraint.

---

## 3. Table classification

### 3.1 Tenant-scoped (RLS on `organization_id`)

Every business table gets `organizationId` + a policy
`USING (organization_id = current_setting('app.organization_id')::text)` (and a
matching `WITH CHECK`), under `FORCE ROW LEVEL SECURITY`:

`Program`, `Member`, `PointAccount`, `PointTransaction`, `PointLot`,
`PointExpiryReminder`, `PointAdjustmentRequest`, `PointRule`, `Tier`,
`MemberTier`, `Campaign`, `CampaignVariant`, `CampaignApplication`, `Segment`,
`Coupon`, `CouponRedemption`, `GiftCardBatch`, `GiftCard`, `GiftCardTransaction`,
`Reward`, `RewardRedemption`, `Badge`, `MemberBadge`, `NotificationTemplate`,
`Notification`, `CoalitionConfig`, `CoalitionAccount`, `CoalitionTransaction`,
`WebhookSubscription`, `MemberDevice`, `MemberNotificationPreferences`,
`TermsTemplate`, `Event`, `AuditLog`.

This includes the child tables that today lack `programId`
(`MemberTier`, `CampaignApplication`, `CouponRedemption`, `RewardRedemption`,
`MemberBadge`, `GiftCard`, `Notification`). They need `organizationId` (or a
policy that joins through their parent) so that "no context → `TenantContextMissing`
/ zero rows" holds for _every_ table, not just the ones with `programId`.

### 3.2 Global (no RLS)

These are read **before** tenant context is established (to establish it), or are
themselves the tenant/identity roots:

| Table                                                 | Why global                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Organization`                                        | The tenant root; read by id to establish context                                                                                          |
| `User`                                                | Cross-org identity; a person belongs to many orgs                                                                                         |
| `OrganizationMembership`                              | The identity↔org join, read during auth to resolve role/org                                                                               |
| `AdminSession`, `Session`, `MagicLinkToken`           | Opaque session/token lookups that happen before any org is known                                                                          |
| `PersonalAccessToken`, `MemberSessionToken`, `ApiKey` | Credential lookup by opaque hash/prefix; the secret _is_ the authorization, and there is no "list all" path — so RLS on them buys nothing |

Credential rows still carry `organizationId` (denormalized) so the **admin list
routes** can filter by org at the application layer; they are simply not
RLS-protected because the auth-time lookup must run without context.

The one pre-context read of a tenant table — resolving `programId → organizationId`
— goes through the `SECURITY DEFINER` function (§2.5), never a direct `Program`
read under the app role.

---

## 4. Migration from 1.9.x (expand → backfill → contract)

All steps are additive and reversible until the final `NOT NULL`/RLS-`enforce`
step. `TENANCY_RLS=off|audit|enforce` gates the behavior; new installs default to
`enforce`, upgrades start at `off` and move through `audit` → `enforce`. Role
provisioning and the two URLs (§2.3) ship first and are orthogonal to the schema
migration.

1. **Expand (reversible: drop).** Create `Organization`, `User`,
   `OrganizationMembership`; add nullable `organizationId` to every business
   table plus `Program.organizationId` and `Program.@@unique([id, organizationId])`;
   add the composite FK on every `programId` table (with `MATCH SIMPLE` it only
   enforces once `organizationId` is non-null). Add `ApiKey.keyHash` +
   `ApiKey.prefix`. `AdminUser` and all existing behavior keep working through a
   compatibility path (`AdminUser → (User, membership)`) that lives for **two
   releases**.
2. **Backfill (idempotent, resumable, batched).** Create a single `default`
   `Organization`. Assign every existing `Program` to it. Copy `organizationId`
   into every child row by join (batch 10k rows, outside peak). Convert each
   `AdminUser` into one `User` (by email) + one `OrganizationMembership` in the
   default org with its current `role` and `programIds = [its programId]`.
   Hash every `ApiKey.key` into `keyHash` + `prefix`.
   `pnpm --filter @loyaltyos/api tenancy:backfill --dry-run` first. A
   `tenancy:move-program <programId> <organizationId>` script moves a program to
   a new or existing organization later, updating the composite-key rows
   atomically in one transaction (with tests).
3. **Contract (partially reversible).** Set `organizationId NOT NULL` (the
   composite FK is now fully enforced), create composite indexes
   `(organizationId, …)`, and enable RLS. Flip `TENANCY_RLS` to `audit` (log
   queries that would be denied), observe, then `enforce`. Drop the `AdminUser`
   compatibility path and the `ApiKey.key` plaintext column after the two-release
   window.

Self-hosted single-program installs: the `default` org is created once; from the
user's point of view nothing changes — same credentials, same program, RLS
always scoped to the one org.

---

## 5. Impact

- **API.** `request.programId` remains; the auth plugin additionally derives
  `request.organizationId` (directly from the credential's owner, or via
  `Program.organizationId` / `app_org_for_program`). Route policy and
  `can(role, permission)` are unchanged except that `role` comes from the active
  membership. `X-Program-Id` may only narrow to a program of the same
  organization (already enforced today for PAT/member-token/API-key).
- **Admin UI.** A user with one membership sees no change. A user with two
  memberships gets an **organization selector** in the top bar; switching it
  swaps the active membership (and thus the visible program set and role).
- **MCP.** PATs resolve through their membership, so MCP tools are automatically
  scoped to the token's organization; no new wiring beyond the auth change.
- **Configuration.** `DATABASE_URL` (app role) and `MIGRATION_DATABASE_URL`
  (owner) replace a single URL; `.env.example`, `docker-compose.yml`, and the
  Helm values are updated, and the boot guard refuses to start on a
  superuser/BYPASSRLS connection under `audit`/`enforce`.
- **Documentation.** `UPGRADING.md` gains the tenancy steps (role provisioning,
  backfill command, `tenancy:move-program`, `TENANCY_RLS` transition); new docs
  describe the multi-organization model.
- **Existing users.** Nothing visible changes in a single-program install. The
  only observable differences are the presence of the default organization, the
  two URLs, and the (optional) hashing of API keys.

---

## 6. Risks and performance

**RLS overhead.** Every query gains `organization_id = $n`, and `set_config` runs
once per transaction (not per query). The benchmark (k6, M1) measures
`POST /events` p50/p95 with and without RLS on a seeded database.
**Thresholds: p95 regression ≤ +15 % AND absolute p95 < 150 ms** on the reference
benchmark.

**Plan B if either threshold is exceeded, in order:**

1. Composite indexes leading with `organization_id` (so the RLS predicate is an
   index probe, not a filter-after-scan) — likely enough on its own.
2. Move `set_config` out of the transaction to a `SET LOCAL` issued once on
   connection checkout with a request-scoped pool, dropping the extra statement
   per transaction.
3. As a last resort, disable RLS on the hottest tables and rely on the existing
   application-level `programId` filtering — documented and gated behind
   `TENANCY_RLS`, with an explicit, named acceptance of the weakened guarantee.

**Other risks.** Backfill on large tables (`PointTransaction`) must be batched
and resumable. The composite FK adds a constraint check on writes — measured in
the benchmark. The `loyaltyos_app` role must never be granted `BYPASSRLS` — a CI
test asserts this, and the boot guard enforces it at runtime.

---

## 7. Rollout as small PRs (tests per PR)

Each PR is independently mergeable and leaves the suite green. The plan grew from
10 to **13** PRs to absorb the role provisioning, the composite FK, the
`SECURITY DEFINER` function + fail-visible context, and the org-scoped worker
sweeps.

| #   | PR                                                                                                                                                                                                                                                  | Tests / acceptance criteria                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **DB role provisioning + two URLs + boot guard** — migration/script creates `loyaltyos_app` (`NOSUPERUSER NOBYPASSRLS`) + grants; `DATABASE_URL` vs `MIGRATION_DATABASE_URL`; docker-compose, Helm, `.env.example`                                  | app role lacks `BYPASSRLS`; boot refuses under superuser/BYPASSRLS with `audit\|enforce`; suite green under the new role                         |
| 2   | **`Organization` + `User` + `OrganizationMembership` (additive)** — schema, migration, seed `default` org; `AdminUser` compatibility path                                                                                                           | migration idempotent; seed creates `default` org; existing admin tests green                                                                     |
| 3   | **`organizationId` on all tables + composite FK + backfill + `move-program`** — nullable column; `Program.@@unique([id, organizationId])`; composite FK `(programId, organizationId)→Program`; batched backfill                                     | backfill idempotent/resumable; composite FK rejects divergent rows; `move-program` tests                                                         |
| 4   | **`packages/tenancy` core** — `TenantContext`, `AsyncLocalStorage`, transaction-aware Prisma `$extends` (wrap `$transaction`, batch form, raw), `SECURITY DEFINER app_org_for_program`, fail-visible `TenantContextMissing`, global-model exemption | `set_config` once per transaction; loose query batch; raw covered; raw `FOR UPDATE` respects RLS; no-context throws (`enforce`) / logs (`audit`) |
| 5   | **RLS policies + `TENANCY_RLS=audit→enforce`** — generated policies, audit mode logs denials                                                                                                                                                        | two-org DB test: cross-org read/write denied, same-org allowed                                                                                   |
| 6   | **Pre-context entry points** — member login, magic link, widget `X-Program-Id`, `/auth/*` resolve org via `app_org_for_program`/cache                                                                                                               | each entry point resolves org without reading `Program` under the app role; ledger 20-run concurrency suite green under `enforce`                |
| 7   | **`User`/membership auth flow + org selector (backend)** — login resolves membership; org switch; `AdminUser` compat for 2 releases                                                                                                                 | login; role resolution; two-org user switches and sees only the active org; `admin:create` still works                                           |
| 8   | **PAT + member-token + API-key rebind** — PAT→membership, effective-role rule, org on credentials                                                                                                                                                   | PAT effective role `min(token, membership)`; cross-org PAT denied; member token inherits org                                                     |
| 9   | **Security: hash API keys** — `ApiKey.keyHash` + `prefix`, migration hashes existing keys, auth looks up by hash, plaintext column dropped later                                                                                                    | migration hashes without collision; lookup by hash; plaintext no longer readable; seed shows key once                                            |
| 10  | **Security: Fastify 5 + `@fastify/helmet`** — Fastify `4.28 → 5`, `@fastify/helmet` `11 → 13` (compatible), all plugins bumped                                                                                                                      | full suite (unit + MCP E2E + smoke) green                                                                                                        |
| 11  | **Workers: org-scoped sweeps** — expiry, reminders, settlement, reconciliation, token cleanup list orgs via `app_list_organization_ids()` then process per-org under the app role                                                                   | the listing function returns only ids and runs `SECURITY DEFINER`; per-org processing under app role; sweep tests green under `enforce`          |
| 12  | **Admin org selector + MCP + docs** — UI switcher, MCP scoping, `UPGRADING.md`, `.env.example`/docker-compose/Helm docs                                                                                                                             | admin UI switch; MCP scoped; docs accurate                                                                                                       |
| 13  | **RLS benchmark + report** — k6 `POST /events`, p50/p95, `docs/cloud/benchmarks/`                                                                                                                                                                   | +15 % p95 AND absolute p95 < 150 ms verified, or plan B documented                                                                               |

**Definition of Done (M1):** every business table has `organizationId NOT NULL`, a
composite FK to `Program`, and RLS `enforce` in CI; the app role is `NOSUPERUSER
NOBYPASSRLS` and the boot guard rejects superuser/BYPASSRLS connections; the
pre-context entry points resolve org via `app_org_for_program`; worker sweeps
list orgs under the owner role and process per-org under the app role; the
isolation suite runs against **two organizations × two programs**; the ledger
20-run concurrency suite passes under `enforce`; a v1.9.2 seeded DB upgrades and
is verified; the RLS benchmark report is published.

**Rollback:** `TENANCY_RLS=off`; the added columns don't break 1.9.x; the
`AdminUser` compatibility path stays for 2 releases.

---

## 8. Decisions (previously open questions)

1. **No `Tenant` in the core.** Confirmed — `Organization` is the tenant
   boundary; `Tenant` is Cloud billing/provisioning.
2. **Role names.** Keep `SUPER_ADMIN`/`OPERATOR`/`ANALYST`.
3. **Default org + move-program.** One `default` organization for existing
   installs, plus a `tenancy:move-program` script (with tests) to move a program
   to a new organization.
4. **Denormalize `organizationId`.** Yes, with the composite FK (§2.6)
   guaranteeing consistency.
5. **RLS defaults.** Upgrades `off → audit → enforce`; new installs `enforce`.
6. **API keys.** Hash-only in M1; `IntegrationClient` with scopes deferred.
7. **Benchmark.** +15 % p95 on `POST /events` AND absolute p95 < 150 ms on the
   reference benchmark.
8. **`AdminUser` compatibility.** Two releases.

**Out of scope for M1:** MFA (TOTP) — it ships with the Cloud platform roles, not
in the OSS tenancy foundation.

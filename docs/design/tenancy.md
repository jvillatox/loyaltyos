# Multi-tenant foundation (tenancy) — Design

> Status: **Design only**. No code has been written yet. This document is the
> review artifact for M1 (tenancy) of the Cloud plan and is scoped strictly to
> the open-source core. It must behave identically in a single-program
> self-hosted install: no partners, funding, or commercial Cloud data belong in
> this repository or in this design.

## Summary

LoyaltyOS currently isolates data with a single column, `programId`, derived from
the authenticated credential (`admin`/`member`/PAT/member-token/API key). M1
introduces an explicit tenant root — **`Organization`** — and makes it the
hard database isolation boundary with **PostgreSQL Row-Level Security (RLS)**.
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
   (the same pattern `programId` already follows). `programId` remains for
   defense-in-depth and for per-member/program scope.

Roles stay `SUPER_ADMIN` / `OPERATOR` / `ANALYST`. Renaming them to
`BUSINESS_OWNER`/`BUSINESS_MANAGER`/`BUSINESS_ANALYST` is cosmetic churn for
self-hosters and is left to Cloud; the `@loyaltyos/permissions` map and the
admin UI are untouched by the naming.

The migration is **expand → backfill → contract**: additive and reversible at
every step, with a single default `Organization` for existing installs and
`AdminUser` evolving to `User` + `OrganizationMembership`.

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

`Program` gains one column:

```prisma
model Program {
  // … existing fields unchanged …
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)

  @@index([organizationId])
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
  mfaSecretEnc String?     // TOTP secret, encrypted at rest
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

### 1.3 Relationship to the existing auth surface

| Existing concept                  | Today (v1.9.2)                                                                                                                                                      | After M1                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin session                     | `AdminSession.userId → AdminUser`; role from `AdminUser.role`                                                                                                       | `AdminSession.userId → User`; session carries `activeMembershipId` (or `activeOrganizationId`) so a multi-org user's org choice survives the cookie             |
| Personal access token (`lopat_…`) | `PersonalAccessToken.adminUserId → AdminUser`; already hashed (`tokenHash` + `prefix`); `role` stamped on the token; effective role = `min(token.role, owner.role)` | `PersonalAccessToken.membershipId → OrganizationMembership` (implies `userId` + `organizationId` + `role`); effective role = `min(token.role, membership.role)` |
| API key (`X-API-Key`)             | `ApiKey.programId` + `scope` (`SERVER`/`CLIENT`); **plaintext `key`**                                                                                               | `ApiKey.organizationId` + `keyHash` + `prefix` (hashed; see §7.2)                                                                                               |
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

### 2.2 Setting the context per request with Prisma

The context is a transaction-local Postgres GUC:

```sql
SELECT set_config('app.organization_id', $1, /* is_local */ true);
```

`is_local = true` makes it equivalent to `SET LOCAL`: it lives only for the
current transaction and is discarded at commit/rollback. This is what makes it
safe with a connection pool — a pooled connection never leaks one tenant's
context into the next request.

Implementation shape (in the new `packages/tenancy`):

```ts
// AsyncLocalStorage carries the current tenant through the request/job.
export interface TenantContext {
  organizationId: string;
  programId?: string;
}

// A Prisma client extension wraps every query in an interactive transaction
// that first sets the GUC, then runs the operation.
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const ctx = tenantStorage.getStore();
        if (!ctx) return query(args); // no context → 0 rows (RLS denies)
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.organization_id', ${ctx.organizationId}, true)`;
          return query(args);
        });
      },
    },
  },
});
```

The Fastify `preHandler` (or a `onRequest` hook) derives the context from the
authenticated credential and runs the handler inside `tenantStorage.run(ctx, …)`.

Two guarantees fall out of this design:

- **No context → zero rows.** `FORCE ROW LEVEL SECURITY` plus a policy that
  matches only `current_setting('app.organization_id')` means a query without
  context matches nothing.
- **Deny-by-default at the DB**, independent of any application bug. Even a
  missing `where` clause in a repository cannot leak rows across organizations.

### 2.3 Database roles

| Role                 | Grants                                                                 | BYPASSRLS | Used by                                   |
| -------------------- | ---------------------------------------------------------------------- | --------- | ----------------------------------------- |
| `loyaltyos_owner`    | owns tables, full DDL                                                  | yes       | `prisma migrate deploy`                   |
| `loyaltyos_app`      | `SELECT/INSERT/UPDATE/DELETE` on business tables, `USAGE` on sequences | **no**    | the API runtime                           |
| `loyaltyos_platform` | DML + BYPASSRLS                                                        | yes       | audited cross-tenant background jobs only |

`ALTER TABLE … FORCE ROW LEVEL SECURITY` is applied to every tenant table so
that even the table owner is subject to the policy (only superusers are exempt).
This matters for self-hosted installs that connect with a single role that owns
the tables: RLS still applies to the app's queries.

The `app.organization_id` GUC is a plain text GUC, so it is not itself a
security control against a compromised DB role — it is a guardrail for correct
application code. A role with `BYPASSRLS` (owner/platform) can always read
everything, which is why `loyaltyos_platform` is restricted to narrow, audited
jobs.

### 2.4 Connection pool, workers, scripts, migrations

- **Connection pool:** safe, because `set_config(…, true)` is transaction-local.
  No per-tenant pooling or connection pinning is required in the base design.
- **BullMQ workers (no request):** each job carries `organizationId` in its
  payload (or derives it from the row it operates on, e.g.
  `PointLot.programId → Program.organizationId`), and the worker runs its body
  inside `tenantStorage.run(ctx, …)`. Jobs that legitimately span tenants (rare
  in the core — e.g. a global sweep) run under `loyaltyos_platform` and are
  audited.
- **Scripts** (`admin:create`, `admin:token:*`, `coalition:reencrypt`,
  `tenancy:backfill`): administrative, cross-tenant by nature → run under
  `loyaltyos_owner`/`loyaltyos_platform` (BYPASSRLS), not the app role.
- **Migrations:** run under `loyaltyos_owner` (BYPASSRLS). This is essential:
  with `FORCE RLS` and no context, a backfill `UPDATE` under the app role would
  match zero rows.

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
policy that joins through their parent) so that "no context → zero rows" holds
for _every_ table, not just the ones with `programId`.

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

---

## 4. Migration from 1.9.x (expand → backfill → contract)

All steps are additive and reversible until the final `NOT NULL`/RLS-`enforce`
step. `TENANCY_RLS=off|audit|enforce` gates the behavior; new installs default to
`enforce`, upgrades start at `off` and move through `audit` → `enforce`.

1. **Expand (reversible: drop).** Create `Organization`, `User`,
   `OrganizationMembership`, and add `organizationId` (nullable) to every
   business table plus `Program.organizationId`. Add `ApiKey.keyHash` +
   `ApiKey.prefix`. `AdminUser` and all existing behavior keep working (a
   compatibility path resolves `AdminUser → (User, membership)` behind the
   scenes for 1–2 releases).
2. **Backfill (idempotent, resumable, batched).** Create a single `default`
   `Organization`. Assign every existing `Program` to it. Copy `organizationId`
   into every child row by join (batch 10k rows, outside peak). Convert each
   `AdminUser` into one `User` (by email) + one `OrganizationMembership` in the
   default org with its current `role` and `programIds = [its programId]`.
   Hash every `ApiKey.key` into `keyHash` + `prefix`.
   `pnpm --filter @loyaltyos/api tenancy:backfill --dry-run` first.
3. **Contract (partially reversible).** Set `organizationId NOT NULL`, create
   composite indexes `(organizationId, …)`, and enable RLS. Flip
   `TENANCY_RLS` to `audit` (log queries that would be denied), observe, then
   `enforce`. Drop the `AdminUser` compatibility path and the `ApiKey.key`
   plaintext column in a later release (one-release window).

Self-hosted single-program installs: the `default` org is created once; from the
user's point of view nothing changes — same credentials, same program, RLS
always scoped to the one org.

---

## 5. Impact

- **API.** `request.programId` remains; the auth plugin additionally derives
  `request.organizationId` (directly from the credential's owner, or via
  `Program.organizationId`). Route policy and `can(role, permission)` are
  unchanged except that `role` comes from the active membership. `X-Program-Id`
  may only narrow to a program of the same organization (already enforced today
  for PAT/member-token/API-key).
- **Admin UI.** A user with one membership sees no change. A user with two
  memberships gets an **organization selector** in the top bar; switching it
  swaps the active membership (and thus the visible program set and role).
- **MCP.** PATs resolve through their membership, so MCP tools are automatically
  scoped to the token's organization; no new wiring beyond the auth change.
- **Documentation.** `UPGRADING.md` gains the tenancy steps (backfill command,
  `TENANCY_RLS` transition); new docs describe the multi-organization model.
- **Existing users.** Nothing visible changes in a single-program install. The
  only observable difference is the presence of the default organization and the
  (optional) hashing of API keys.

---

## 6. Risks and performance

**RLS overhead.** Every query gains `organization_id = $n`, and the
`set_config` inside an interactive transaction adds a round-trip per query. The
benchmark (k6, M1) measures `POST /events` p50/p95 with and without RLS on a
seeded database. **Threshold: p95 regression ≤ +15 %.**

**Plan B if the threshold is exceeded, in order:**

1. Composite indexes leading with `organization_id` (so the RLS predicate is an
   index probe, not a filter-after-scan) — likely enough on its own.
2. Amortize `set_config`: set the GUC once per _request_ (one interactive
   transaction spanning the handler) instead of once per query.
3. If the per-request transaction serializes too much, keep per-query
   transactions but move `set_config` to a `SET LOCAL` issued once on connection
   checkout with a request-scoped pool.
4. As a last resort, disable RLS on the hottest tables and rely on the existing
   application-level `programId` filtering — documented and gated behind
   `TENANCY_RLS`, with an explicit, named acceptance of the weakened guarantee.

**Other risks.** Backfill on large tables (`PointTransaction`) must be batched
and resumable; the composite unique keys already scoped by `programId` do not
collide (the `organizationId` is derived, not a new key). The `loyaltyos_app`
role must never be granted `BYPASSRLS` — a CI test asserts this.

---

## 7. Rollout as small PRs (tests per PR)

Each PR is independently mergeable and leaves the suite green.

| #   | PR                                                                                                                                                      | Tests / acceptance criteria                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | **`Organization` + `User` + `OrganizationMembership` (additive)** — schema, migration, seed; `AdminUser` compatibility path                             | migration idempotent; seed creates `default` org; existing admin tests still green                     |
| 2   | **`organizationId` on all business tables + backfill** — nullable column, batched backfill script (`--dry-run`)                                         | backfill idempotent/resumable; data-integrity check; `organizationId` correct across child joins       |
| 3   | **`packages/tenancy`** — `TenantContext`, `AsyncLocalStorage`, Prisma `$extends`, DB roles                                                              | "no context → 0 rows" per table; context set/cleared across pooled connections                         |
| 4   | **RLS policies + `TENANCY_RLS=audit→enforce`** — generated policies, audit mode logs denials                                                            | two-org DB test: cross-org read/write denied, same-org allowed                                         |
| 5   | **`User`/membership auth flow + org selector** — login resolves membership; org switch; `AdminUser` compat for 1–2 releases                             | login; role resolution; two-org user switches and sees only the active org; `admin:create` still works |
| 6   | **PAT + member-token + API-key rebind** — PAT→membership, effective-role rule, org on credentials                                                       | PAT effective role `min(token, membership)`; cross-org PAT denied; member token inherits org           |
| 7   | **Security: hash API keys** — `ApiKey.keyHash` + `prefix`, migration hashes existing keys, auth looks up by hash, plaintext column dropped next release | migration hashes without collision; lookup by hash; plaintext no longer readable; seed shows key once  |
| 8   | **Security: Fastify 5 + `@fastify/helmet`** — Fastify `4.28 → 5`, `@fastify/helmet` `11 → 13` (compatible), all plugins bumped                          | full suite (unit + MCP E2E + smoke) green                                                              |
| 9   | **Admin org selector + MCP + docs** — UI switcher, MCP scoping, `UPGRADING.md`                                                                          | admin UI switch; MCP scoped; docs accurate                                                             |
| 10  | **RLS benchmark + report** — k6 `POST /events`, p50/p95, `docs/cloud/benchmarks/`                                                                       | report published; threshold +15 % p95 verified or plan B documented                                    |

**Definition of Done (M1):** every business table has `organizationId NOT NULL`
and RLS `enforce` in CI; `loyaltyos_app` has no `BYPASSRLS`; the isolation suite
runs against **two organizations × two programs**; a v1.9.2 seeded DB upgrades
and is verified; the RLS overhead report is published.

**Rollback:** `TENANCY_RLS=off`; the added columns don't break 1.9.x; the
`AdminUser` compatibility path stays for 1–2 releases.

---

## 8. Open questions (need a decision)

1. **Skip `Tenant` in the core?** Recommended **yes** (organization _is_ the
   tenant boundary; `Tenant` is Cloud billing/provisioning). Confirm, or decide
   whether Cloud needs a `tenant` table keyed by `organizationId`.
2. **Role naming.** Keep `SUPER_ADMIN`/`OPERATOR`/`ANALYST` (recommended), or
   rename to `BUSINESS_*` now? Renaming touches `@loyaltyos/permissions`, the
   admin UI, PATs, seed, and tests.
3. **One default org for existing multi-program installs.** This collapses the
   current per-program admin model into one org with program-scoped memberships;
   cross-program isolation then relies on the (existing, tested) application
   `programId` filtering. Acceptable, or should each program become its own
   organization?
4. **`organizationId` denormalized on every table** vs. RLS policies that join
   through `Program`. Recommended: denormalize (fast, trivial policies, matches
   `programId`). Confirm you accept ~40 added columns.
5. **RLS default on self-hosted upgrade.** Recommended `off → audit → enforce`
   via `TENANCY_RLS`. Confirm the default for _new_ installs (`enforce`).
6. **API keys:** just hash in M1 (recommended), or also introduce
   `IntegrationClient` with scopes now? Full scopes can wait.
7. **Benchmark threshold.** Confirm +15 % p95 on `POST /events` as the acceptance
   number.
8. **`AdminUser` compatibility window.** Keep the compatibility path for 1 or 2
   releases before removing it?

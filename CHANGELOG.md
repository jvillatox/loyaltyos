# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Database role separation for row-level security (M1 groundwork).** A new
  idempotent provisioning script (`apps/api/src/tenancy-provision.ts`) creates the
  least-privileged `loyaltyos_app` runtime role (`NOSUPERUSER NOBYPASSRLS`), grants
  it DML on existing tables, and installs `ALTER DEFAULT PRIVILEGES` so tables
  created by future migrations stay reachable. It also creates a `SECURITY DEFINER`
  `app_list_organization_ids()` function (owned by the migration owner) so worker
  sweeps can list organizations without any `BYPASSRLS` runtime role. The password
  comes from `LOYALTYOS_APP_DB_PASSWORD` (never from the repository).

- **Two database URLs.** `DATABASE_URL` now targets the app role for the API and
  workers, while `MIGRATION_DATABASE_URL` (owner) drives `prisma migrate deploy` and
  administrative scripts; it falls back to `DATABASE_URL` when unset.

- **Tenancy boot guard.** With `TENANCY_RLS=audit|enforce`, the API refuses to start
  if `DATABASE_URL` connects as a superuser or `BYPASSRLS` role; with `off` it only
  logs an informational warning.

- **Tenancy identity models (Organization, User, OrganizationMembership).** An
  additive migration introduces the tenancy tables alongside the existing
  `AdminUser`. Auth still reads `AdminUser` (no visible change); a compatibility
  layer mirrors every `AdminUser` write to `User` + `OrganizationMembership` in the
  same transaction, and an idempotent `pnpm --filter @loyaltyos/api
tenancy:backfill-users` script backfills the `default` organization and one
  `User` + membership per `AdminUser`. This is groundwork for the RLS-based
  multi-tenant switch (see `docs/design/tenancy.md`).

### Upgrade notes

1. **No action required yet.** `TENANCY_RLS` defaults to `off`, and the provision
   script no-ops when `LOYALTYOS_APP_DB_PASSWORD` is unset, so existing
   single-role deployments keep working unchanged.
2. **When the role split is activated** (a future M1 release), set
   `LOYALTYOS_APP_DB_PASSWORD`, point `DATABASE_URL` at `loyaltyos_app`, keep
   `MIGRATION_DATABASE_URL` on the owner, and move `TENANCY_RLS` from `off`
   through `audit` to `enforce`.
3. **Provisioning requires `CREATEROLE`.** The provisioning script issues
   `CREATE ROLE`, so the `MIGRATION_DATABASE_URL` owner must have `CREATEROLE`. A
   plain DB owner has it, but on managed Postgres (RDS, Cloud SQL, Azure) the
   provisioned admin may not — have a DBA run the equivalent SQL from
   `docs/design/tenancy.md` §2.3 once, then leave `LOYALTYOS_APP_DB_PASSWORD`
   unset to skip re-provisioning.

## [1.9.2] - 2026-11-19

> **Security release.** All deployments of v1.9.1 and earlier should upgrade. See advisory GHSA-388r-m42q-5f6x.

### Security

- **Coalition member history no longer leaks other members' transactions.** The
  `GET /members/:id/coalition/history` endpoint previously returned the partner's
  full account history — the Apprecio adapter ignores the member reference — so a
  member, whether authenticated by portal session or `lomem_` widget token, could
  see another member's loads. Members now receive only their own local
  `CoalitionTransaction` rows, never the partner's raw response. The server-side
  path filters the partner's response by the member's identifier and falls back
  to local history when the partner's format cannot be filtered with certainty.
- **The API refuses to start in production without a strong master encryption
  key.** Coalition credentials are encrypted with `KMS_MASTER_KEY`. In
  `NODE_ENV=production` the API now fails to boot when the key is missing or
  shorter than 32 characters instead of silently falling back to a well-known
  development key. The development fallback remains active only outside
  production.

### Upgrade notes

1. **Set `KMS_MASTER_KEY` to at least 32 characters in production.** The API
   refuses to start otherwise. Use a strong, randomly generated secret.
2. **Re-encrypt credentials written with the development fallback key.** If
   coalition credentials were stored while `KMS_MASTER_KEY` was unset (and were
   therefore encrypted with the development fallback key), re-encrypt them after
   setting the new key:

   ```
   pnpm --filter @loyaltyos/api coalition:reencrypt --from-key <old-key>
   ```

## [1.9.1] - 2026-11-19

### Changed

- **Release verifies images are public and multi-arch.** The release workflow now
  checks that each published image is anonymously pullable from GHCR and that its
  manifest includes both `linux/amd64` and `linux/arm64`, failing the release with
  a clear message if either check does not pass.

### Fixed

- **Docker images are now multi-arch (linux/amd64 and linux/arm64).** The API,
  admin, and portal images are built for both `linux/amd64` and `linux/arm64`, so
  they run natively on Apple Silicon and ARM servers.

### Known limitations

- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.9.0] - 2026-11-18

### Added

- **Per-program Apprecio credentials.** `CoalitionConfig` now stores a `country`
  (MX, CL, CO, PE, EC, or `OTHER` for a custom API base URL) and an
  `identifierType` (`email` | `rut`). The Apprecio adapter is built per program
  from its decrypted config (cached per program and rebuilt automatically on
  every instance when the config changes) instead of a single process-wide
  adapter. The admin _Coalición_ screen gains a country selector and
  identifier-type toggle, and its "Probar conexión" healthcheck now requires
  `coalition.write` (SUPER_ADMIN). Each program has its own circuit breaker, so
  one program with failing credentials no longer blocks coalition calls for the
  others. (#59)

### Changed

- **Unique `ts` and transaction reference on every Apprecio call.** Loads use the
  internal `CoalitionTransaction` id as `ts`; balance/history/healthcheck use a
  random alphanumeric code. The `descripcion` now carries the reference
  `"<description> [LOS:<transaction id>]"`, truncated to a conservative length.
  TLS is always enforced — a non-https API base URL is rejected. (#59)

### Fixed

- **The coalition admin pages are translated.** The _Coalición_ config,
  transactions, and linked-members pages now render in es-MX and en-US instead of
  hard-coded English strings. (#59)

### Upgrade notes

1. **Run the migration before deploying.** This adds the
   `CoalitionConfig.country` and `CoalitionConfig.identifierType` columns.
2. **Migrate from `APPRECIO_*` env vars to per-program config.** The
   `APPRECIO_API_BASE`, `APPRECIO_PUBLIC_TOKEN`, `APPRECIO_PRIVATE_TOKEN`,
   `APPRECIO_IDENTIFIER_TYPE`, and `APPRECIO_TIMEOUT_MS` env vars are deprecated
   and only apply as a fallback in single-program installs with no
   `CoalitionConfig`. With more than one program, each program must be configured
   in the admin _Coalición_ screen; a program without a `CoalitionConfig` is an
   error. A deprecation warning is logged at startup when these vars are still
   set.

### Known limitations

- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.8.0] - 2026-11-17

### Added

- **Configurable point expiry modes.** `Program.expiryMode` now controls how
  points expire: `NONE` (never), `INACTIVITY` (an account's points expire
  `expiryMonths` after its last activity) and `PER_LOT` (each lot of points
  expires `expiryMonths` after it becomes spendable). Points are tracked as
  per-lot records (`PointLot`) and expire FIFO (soonest first); the daily expiry
  job removes expired lots and idle accounts idempotently, and a redeem consumes
  the soonest-expiring lots first. The admin _Program settings_ page gains a
  "Vencimiento de puntos" section, and the portal and widget show an "X points
  expire on \<date\>" line when the next expiry falls within 90 days. (#33)

- **30-day expiry reminders by email.** A daily job emails each member 30 days
  before their points expire, once per `(member, expiry date)`. `PER_LOT`
  members receive one email grouping the lots that share an expiry date;
  `INACTIVITY` members receive one 30 days before their idle-account deadline
  (`max(lastActivityAt, expiryChangedAt) + expiryMonths`). The message is the
  per-program editable `points.expiry_reminder` template (es-MX and en-US,
  mode-aware), and it respects member notification preferences — members who
  opted out of email are skipped rather than emailed. Deduplication lives in a
  `PointExpiryReminder` unique constraint, so two jobs running at once cannot
  double-send. (#33)

### Fixed

- **The widget's top rewards load again.** The component expected an array but
  `GET /rewards` returns `{ data: { items, total } }`, so the section stayed on a
  spinner.
- **Dates use the member's locale format** in the portal and widget.

### Upgrade notes

1. **Run the migration before deploying.** This adds the `PointLot` and
   `PointExpiryReminder` tables, the `PointAccount.debt` and
   `PointAccount.lastActivityAt` columns, and the `expiryMode` / `expiryMonths`
   / `expiryChangedAt` program fields; it backfills one never-expiring lot per
   account from its current balance and drops the legacy
   `PointTransaction.expiresAt` column. Existing programs are backfilled to
   `NONE` so no one loses points on upgrade; new programs default to
   `INACTIVITY` with 12 months. To start expiring points, pick a mode on the
   _Program settings_ page — the clock starts from that moment, so points that
   already exist begin their expiry window when the mode is enabled or changed.
2. **Run a worker with Redis.** Expiration and the 30-day expiry reminders are
   scheduled BullMQ jobs (expiry daily, with the reminder step running alongside
   it), so the API's worker process — or the standalone worker — must be running
   with a Redis connection; otherwise points never expire and no reminder is
   emailed.

### Known limitations

- The Apprecio adapter uses the environment credential, not the per-program
  stored credential (#59).
- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.7.0] - 2026-11-16

### Added

- **Point adjustments in the MCP server.** Two new tools: `member_adjust_points`
  (add or deduct a member's points with a reason category and a ≥10-character
  comment; idempotent via an optional `idempotencyKey`; returns whether the
  adjustment applied immediately with the resulting balance or was sent for
  approval) and `point_adjustments_list` (read-only, filterable by status and
  member). The `member_adjust_points` description instructs the model to confirm
  the amount, member, and reason with the user before calling. (#44)

- **Program-level point hold days.** `Program.holdDays` (default 10, range 0–90)
  controls how long earned points sit in the pending balance before they can be
  redeemed. The release timestamp is frozen on each EARN at the moment it is
  written, so changing the hold later only affects points earned afterwards. A
  new _Program settings_ field ("Días de retención de puntos") tunes it per
  program, and the portal and widget show the spendable balance as the main
  figure and, while points are held, a secondary line "+X points to be released
  on \<date\>". Settlement (`settlePending`) and expiry (`expire`) now run as
  scheduled BullMQ jobs (hourly and daily). (#34)

### Fixed

- **`verifyConsistency()` no longer flags held EARNs as inconsistent.** Points on
  hold are written with `settledAt = null` and settlement writes no ledger entry,
  so the checker now compares the confirmed balance against the transactions that
  affect it (settled EARNs, REDEEM, ADJUST, REVERSE, EXPIRE) and the pending
  balance against the still-unsettled EARNs, reporting the two differences
  separately. (#35)

- **The widget now renders with its design styles.** The base design tokens
  (font sizes, spacing, radius, weight) were defined in a stylesheet that was
  never loaded, so the widget showed unstyled text; they are now defined on the
  widget host and the points card is centered.

### Changed

- **The portal and widget headline balance is now the spendable balance.** Held
  points are no longer included in the main figure; they appear on a separate
  line with their release date. (#34)

### Upgrade notes

1. **Run the migration before deploying.** This adds `Program.holdDays` (default 10) and `PointTransaction.availableAt`. Existing programs are backfilled to
   `holdDays = 0` so they keep their current behaviour (points available
   immediately); new programs default to 10 days.
2. **Run a worker with Redis.** Settlement and expiry are now scheduled BullMQ
   jobs (settlement hourly, expiry daily), so the API's worker process — or the
   standalone worker — must be running with a Redis connection, otherwise held
   points will never become spendable.

### Known limitations

- Points expiry is not FIFO; expiry removes from the account's current
  spendable balance rather than per-lot (#33).
- The Apprecio adapter uses the environment credential, not the per-program
  stored credential (#59).
- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.6.0] - 2026-11-14

### Added

- **Manual point adjustments with per-program caps and a pending-approval
  flow.** `POST /api/v1/members/:id/adjust` now records why points change and
  enforces configurable per-program limits. A `SERVER` key is capped per
  transaction (`adjustServerPerTxLimit`, default 10000) and gets a 422
  `ADJUST_LIMIT_EXCEEDED` beyond it. An `OPERATOR` is capped per transaction and
  per day (`adjustOperatorPerTxLimit` default 1000, `adjustOperatorDailyLimit`
  default 5000); exceeding either files a PENDING request instead of applying,
  and a `SUPER_ADMIN` (same program, different from the requester) must approve
  or reject it via `POST /api/v1/admin/point-adjustments/:id/approve` and
  `.../reject`. Pending requests left undecided for 7 days expire via a daily
  worker. `SUPER_ADMIN` adjusts directly with no caps. Every adjustment requires
  a reason category and (for admins) a comment of at least 10 characters. (#44)

- **Admin UI for point adjustments.** A new _Point adjustments_ screen lists
  pending requests with an expiry warning and a pending count in the sidebar;
  `SUPER_ADMIN` can approve or reject each request with a comment. A _Program
  settings_ screen tunes the three per-program caps, and the member detail
  page's _Adjust points_ dialog shows the current and resulting balance and
  tells the operator whether the request was applied immediately or sent for
  approval.

### Fixed

- **The dashboard no longer shows a blank screen.** It read the gift-card
  metrics from fields missing from the API response (`activeCards` and
  `redeemedLast30d`), which threw at render time; it now reads the API's
  `active` and `outstandingBalance` fields. Thanks to @rogerv2-ops for
  reporting and fixing it.
- **The rewards editor no longer crashes on empty selectors.** Opening a reward
  with no category or tier rendered empty-value select items that crashed at
  render time. Thanks to @rogerv2-ops for reporting and fixing it.
- **The seed cleans up and reports credentials correctly.** It now deletes
  `PointAdjustmentRequest` and `MemberSessionToken` rows before members (fixing
  a foreign-key error on re-seed) and prints the actual admin password instead
  of a hardcoded one.
- **The member detail page is fully translated.** The remaining hardcoded
  English labels (profile, points balance, transaction history, and table
  headers) now use es-MX and en-US translations.
- **Production compose forwards SMTP, the public portal URL and the CORS
  allowlist.** Magic-link emails now point at `PORTAL_URL` instead of
  localhost, SMTP settings reach the API, and `CORS_ORIGINS` is forwarded; the
  previous `CORS_ORIGIN=*` default blocked every cross-origin request,
  including the widget on merchant sites. Thanks to @rogerv2-ops for finding
  these during a real deployment.

### Deprecated

- **The `reason` field on `POST /api/v1/members/:id/adjust`.** Sending `reason`
  without `reasonCategory` is accepted as `reasonCategory: "OTHER"` with
  `comment` set to `reason`, and the response carries a `Deprecation: true`
  header. This field is removed in 2.0 — migrate to `reasonCategory` +
  `comment`. (#44)

### Upgrade notes

1. **Run the migration before deploying.** This adds the
   `PointAdjustmentRequest` table and three per-program limit columns
   (`adjustOperatorPerTxLimit`, `adjustOperatorDailyLimit`,
   `adjustServerPerTxLimit`). Run `prisma migrate deploy` as part of the
   upgrade.
2. **Default caps.** Existing programs get the defaults on migration: OPERATOR
   1000 points/transaction and 5000 points/day; SERVER 10000 points/transaction.
   SUPER_ADMIN can tune these per program via
   `PATCH /api/v1/admin/programs/:id`.
3. **The daily cap is counted by UTC day.** The OPERATOR daily limit resets at
   midnight UTC, not in the program's local timezone.
4. **Set `PORTAL_URL`, the `SMTP_*` variables and `CORS_ORIGINS`** in your
   production environment. `CORS_ORIGINS` must list the admin and portal
   origins and every merchant site that embeds the widget; `*` is not
   supported.

### Known limitations

- Points expiry is not FIFO; expiry removes from the account's current
  spendable balance rather than per-lot (#33).
- `holdDays` is a service-wide setting, not per-program, and
  `settlePending()` / `expire()` are not scheduled automatically (#34).
- `verifyConsistency()` still flags held EARNs as inconsistent until they
  settle (#35).
- The Apprecio adapter uses the environment credential, not the per-program
  stored credential (#59).
- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.5.0] - 2026-11-12

### Added

- **Member session tokens for the widget.** The widget can now authenticate a
  member without ever receiving the merchant's `SERVER` key. A merchant backend
  mints a short-lived, read-only `lomem_…` bearer token via
  `POST /api/v1/members/:id/session-token` (SERVER-only) and hands it to the
  widget, which sends it as `Authorization: Bearer lomem_…`. Tokens are stored
  hashed (SHA-256), default to a 900-second TTL (max 3600), are read-only (any
  non-GET/HEAD request returns 403), and can be revoked with
  `DELETE /api/v1/members/:id/session-tokens`. Expired and revoked tokens are
  deleted by a daily cleanup job. The widget gains a `client-key` attribute for
  the anonymous rewards catalog, a public `setAuthToken()` method, and a
  `loyaltyos:auth-required` event fired on 401. (#58)

### Fixed

- **Widget documentation matches the real widget.** The integration guides now
  list the actual attributes (`program-id`, `api-base`, `auth-token`,
  `client-key`, `theme`, `accent-color`, `locale`, `compact`, `mode`) and use an
  `api-base` ending in `/api/v1`; the widget logs a console warning when it does
  not. Previously the `auth-token` attribute had no effect and every widget
  request returned 401. (#58)

### Upgrade notes

1. **Run the migration before deploying.** This release adds the
   `MemberSessionToken` table. Run `prisma migrate deploy` as part of the
   upgrade. No data backfill is required.
2. **Existing widget embeds.** To show a member's points, badges and tier, your
   backend must mint a member session token with a `SERVER` key and pass it in
   `auth-token`; cache it in the user's session and reuse it until shortly
   before `expiresAt`. Never expose the `SERVER` key in the browser.
3. **Anonymous rewards catalog (optional).** Create a `CLIENT`-scope API key and
   set it in the widget's `client-key` attribute to show the rewards catalog to
   visitors who are not signed in.
4. Make sure `api-base` ends in `/api/v1`. See docs/widget-integration.md for a
   complete example.

### Known limitations

- Points expiry is not FIFO; expiry removes from the account's current
  spendable balance rather than per-lot (#33).
- `holdDays` is a service-wide setting, not per-program, and
  `settlePending()` / `expire()` are not scheduled automatically (#34).
- `verifyConsistency()` still flags held EARNs as inconsistent until they
  settle (#35).
- The Apprecio adapter uses the environment credential, not the per-program
  stored credential (#59).
- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.4.1] - 2026-11-10

### Security

- **Point reversals are scoped to the program.** Reversing a transaction now
  looks it up by id and program, so one program can no longer reverse another
  program's transaction. (#37)

### Fixed

- **Points ledger operations are atomic.** Earn, redeem, reverse, expire, and
  pending-point settlement now run in a single database transaction with
  balance-checked updates and row-level locking, so concurrent requests can
  neither overspend nor lose an earn, and a transaction can be reversed only
  once. Thanks to @rneubauer for the original fix in #29. Reversing a REVERSE
  now fails with `CannotReverseError`.

### Changed

- **Reversing already-spent points may leave the balance negative.** Reversing
  an EARN whose points were already redeemed is now allowed and removes the
  points even when the balance goes negative. While negative, redemption stays
  blocked and later earnings cover the debt first. Each such reversal is
  recorded in the audit log with the acting admin and reason; reversing a
  REVERSE remains forbidden.

### Upgrade notes

1. **Back up your database before migrating.** This release ships a data
   migration that corrects `pendingBalance` (previously double-counted on every
   earn) and backfills `settledAt` on existing transactions. The migration
   rewrites those columns, so back up before running `prisma migrate deploy`.
   After the migration, members' pending balances drop to their correct values;
   this is expected and no points are lost.

### Known limitations

- Points expiry is not FIFO; expiry removes from the account's current
  spendable balance rather than per-lot (#33).
- `holdDays` is a service-wide setting, not per-program, and
  `settlePending()` / `expire()` are not scheduled automatically (#34).
- `verifyConsistency()` still flags held EARNs as inconsistent until they
  settle (#35).
- The embeddable widget cannot authenticate member requests yet (#58).
- The Apprecio adapter uses the environment credential, not the per-program
  stored credential (#59).
- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically (#60).

## [1.4.0] - 2026-11-08

> **Security release.** All deployments of v1.3.0 and earlier should upgrade. See advisory GHSA-4hxr-gr8c-vghw.

### Security

- **Deny-by-default authorization for non-admin routes.** Public API routes are
  now evaluated against a per-route access policy, so a request whose API key
  scope does not match the route is rejected rather than silently processed.
- **Cross-program resource isolation.** Resource lookups and writes are scoped
  to the requesting program; an id owned by another program resolves to a
  generic `404` instead of operating on the foreign record.
- **Program-scoped idempotency keys.** Point, coalition, and event transaction
  idempotency keys are unique per program, so the same key used by two programs
  can no longer resolve (or reuse) the other program's record.
- **Point adjustments record the acting admin.** `/members/:id/adjust` captures
  the real authenticated admin in the audit trail instead of a placeholder.

### Breaking changes

- **CLIENT-scope API keys are read-only and limited to the rewards catalog.**
  A `CLIENT` key can no longer accumulate, redeem, or adjust points, validate or
  redeem coupons or gift cards, or reach any mutation route; it can only read
  `GET /rewards` and `GET /rewards/:id`.
- **Members only reach their own resources.** The `MEMBER` principal is limited
  to `/members/me/*` and to `:id` routes where `:id` matches the authenticated
  member; every other member-scoped route now returns `403`.
- **Point adjustments are restricted.** `/members/:id/adjust` is now reachable
  only with a `SERVER`-scope API key or an admin holding `members.write`
  (`OPERATOR`/`SUPER_ADMIN`); previously any key could adjust any member's points.
- **Cross-program resources return a generic `404`.** Where a foreign id
  previously surfaced a specific error (e.g. `COUPON_NOT_FOUND`), it now returns
  `404 NOT_FOUND` to avoid disclosing resource existence across tenants.

### Changed

- **Coalition adapter calls no longer auto-retry on transient failures.**
  Transient failures (timeouts, network errors, `5xx`, `CoalitionTransientError`)
  leave the transaction `PENDING` with an updated `lastError` and `attempts`
  counter, and the API responds `502`/`503` with `COALITION_OUTCOME_UNKNOWN`.
  Retrying the same `txRef` returns the stored state without calling the adapter
  again; only business rejections (a `4xx` from Apprecio) mark the transaction
  `FAILED`.

### Upgrade notes

1. **Back up your database before migrating.** The migration denormalizes
   `programId` onto `PointTransaction` and `CoalitionTransaction` and backfills
   it from the parent account, which rewrites large tables; the globally-unique
   idempotency keys are replaced with program-scoped compound unique indexes.
2. **Switch `CLIENT`-scope writers to `SERVER`.** Integrations that wrote points,
   coupons, gift cards, or coalition transactions with a `CLIENT` key must move
   that write traffic to a `SERVER`-scope key called from your backend.

### Known limitations

- Points ledger concurrency fixes from #29 are not included in this release.
- The Apprecio adapter uses the environment credential, not the per-program
  stored credential.
- Coalition transactions left `PENDING` after a timeout are not reconciled
  automatically; check the partner's transaction history before retrying with a
  new `txRef`.

## [1.3.0] - 2026-10-28

### Added

- **Personal access tokens (PATs).** Admins mint `lopat_` bearer tokens from the
  admin UI (_API tokens_) or the CLI (`admin:token:create` / `admin:token:list` /
  `admin:token:revoke`). A token is shown exactly once, stored only as a SHA-256
  hash, expires within 90 days, and its effective role is always capped by its
  owner's current role. (#48)
- **Functional MCP server.** The MCP server authenticates with a personal access
  token (`LOYALTYOS_TOKEN`) instead of an internal API key, and gains the
  `analytics_dashboard` and `analytics_campaign` tools backed by the new
  `GET /admin/stats/dashboard` and `GET /admin/campaigns/:id/stats` endpoints. (#48)

### Fixed

- MCP tools now target real `/api/v1` routes with the API's actual request
  schemas, enforced by a contract test against the new `@loyaltyos/api-contract`
  package (route manifest + shared Zod schemas). Previously several tools called
  non-existent endpoints. (#48)

### Removed

- MCP tools that moved money or had no backing endpoint: `member_adjust_points`,
  `giftcards_create_batch`, `giftcards_redeem`, `coalition_accumulate`,
  `coalition_convert`, `coalition_balance`, `reward_redemption_stats`. (#48)

### Security

- **No token material leaks from `/admin/tokens`.** `POST`, `GET`, and `DELETE`
  responses never include `tokenHash`; `DELETE` returns only `{ id, revoked }`
  (idempotent on re-revoke), and a token id owned by another program returns
  `404` rather than `403` so token existence is not disclosed. (#48)
- **Personal access tokens are least-privilege and rate-limited per token.** A
  token cannot create, list, or revoke other tokens, nor modify `/admin/me`, and
  requests authenticated by a PAT are rate-limited per token rather than per IP
  or per session. (#48)

### Upgrade notes

1. Run the new database migration (`prisma migrate deploy`): it adds the
   `PersonalAccessToken` table.
2. **MCP configuration changed.** The MCP server no longer accepts an internal API
   key; set `LOYALTYOS_TOKEN` to a personal access token created in **Admin →
   API Tokens** (or via `admin:token:create`). For example, in Claude Desktop:

   ```json
   {
     "mcpServers": {
       "loyaltyos": {
         "command": "node",
         "args": ["apps/mcp-server/dist/src/index.js"],
         "cwd": "/path/to/loyaltyos",
         "env": {
           "MCP_TRANSPORT": "stdio",
           "LOYALTYOS_API_URL": "http://localhost:3002",
           "LOYALTYOS_TOKEN": "lopat_your-token-here"
         }
       }
     }
   }
   ```

3. **Removed tools.** MCP clients relying on the removed tools must be updated;
   points adjustments will return through a dedicated flow with audit and
   per-role limits (#44).

### Known limitations

- Points ledger concurrency fixes from #29 are not included in this release.
- Manual points adjustment is not available through the MCP; the `/members/:id/adjust` endpoint existed but was not role-restricted in this release (fixed in 1.4.0).

## [1.2.0] - 2026-10-21

### Added

- **Admin roles are enforced across every `/admin/*` route.** Each role — `SUPER_ADMIN`, `OPERATOR`, `ANALYST` — gets a fixed capability set from a single deny-by-default map. Summarized:
  - **ANALYST** — read-only (all `GET`/list/stats/count/estimate/preview), except gift-card code export, plus read-only AI tools.
  - **OPERATOR** — everything `ANALYST` has, plus writes to members, campaigns, coupons (and coupon-code reveal), segments, badges, tiers, rewards, notification templates, and gift-card terms.
  - **SUPER_ADMIN** — everything `OPERATOR` has, plus webhooks, gift-card financial operations and code reveal, coalition, and program settings. (#32)
- **`@loyaltyos/permissions`** — the shared role/permission model consumed by both the API and the admin UI, so the two cannot drift.
- **AI companion filtered by role** — `ANALYST` is offered read-only tools only; `OPERATOR` and `SUPER_ADMIN` see the full set.
- **`admin:create` CLI** — provision an admin with a role (`pnpm --filter @loyaltyos/api admin:create --email --role --program`).
- **Audit log records denied requests** as `ACCESS_DENIED`, capturing the role, method, and route.

### Security

- **Gift card codes are only revealed to `SUPER_ADMIN`.** `OPERATOR`/`ANALYST` see the last four characters only (server-side masking) and cannot export batch codes; the export route now requires the `giftcards.codes.reveal` permission.
- **Coupon codes are masked for `ANALYST`.** `SUPER_ADMIN` and `OPERATOR` see full codes (`coupons.codes.reveal`); `ANALYST` sees only the last four characters in the list, detail, and stats endpoints.
- **Coalition credentials are write-only.** `GET` and `PUT /admin/coalition/config` no longer return `encryptedCredentials`; they return `hasCredentials` instead.
- **Admin routes no longer trust `X-Program-Id`.** The program is always taken from the authenticated session or API key, removing the header-based tenant-switch fallback.

### Changed

- The seed now creates `operator@loyaltyos.dev` (OPERATOR) and `analyst@loyaltyos.dev` (ANALYST) alongside the super admin.

### Breaking changes

- **Admin permissions are enforced by role.** Admins that are not `SUPER_ADMIN` lose access to gift-card financial operations, batch code export, coalition, program settings, and webhooks.
- ANALYST sessions are read-only on non-admin routes too (e.g. `POST /events`, `POST /members` return 403).
- Coupon codes are masked for ANALYST.

### Upgrade notes

> ⚠️ **Review every admin's role before upgrading.** The default role is `OPERATOR`: admins who are not `SUPER_ADMIN` lose access to gift-card financial operations, code export, coalition, program settings and webhooks.

```sql
-- list admins and their roles
SELECT id, email, role FROM "AdminUser" ORDER BY role, email;
-- promote an admin
UPDATE "AdminUser" SET role = 'SUPER_ADMIN' WHERE email = 'admin@example.com';
```

Alternatively, create a new admin with a role: `pnpm --filter @loyaltyos/api admin:create --email <email> --role SUPER_ADMIN --program <programId>`.

Upgrading from v1.0.x? Apply the v1.1.0 upgrade notes first (security release, GHSA-98hf-vcvp-p8j6).

### Known limitations

- Points ledger concurrency fixes from #29 are not included in this release.

## [1.1.0] - 2026-10-18

> **Security release.** All deployments of v1.0.x should upgrade. See advisory GHSA-98hf-vcvp-p8j6.

### Security

- **Admin routes now require an admin session (deny-by-default).** API keys — including SERVER-scope keys — no longer grant access to `/admin/*`.
- **API keys can no longer switch tenants** via `X-Program-Id`; a mismatched header returns 403.
- **Admin UI authenticates with the session cookie only.** Earlier builds embedded an API key (`dev-key`, SERVER-scope in the seed) in the public admin bundle.
- **Production boot guard:** the API refuses to start while the seeded `dev-key` is active.
- **`/metrics` is token-gated** via `METRICS_TOKEN`.
- **AI companion tools run with the operator's admin session**, not a shared API key.
- **Member actions are recorded as `MEMBER`** (previously `ADMIN_USER`) in the audit log.

### Added

- **Admin AI Companion** (off by default, `AI_COMPANION_ENABLED`): read-only tools run directly; any mutating tool requires a server-side, single-use confirmation.
- **Gift cards:** batch generation, redemption, terms templates, admin UI, CSV/XLSX export.
- **i18n:** admin (es-MX/en-US), portal, widget, API errors and notifications.

### Fixed

- **The API Docker image now boots.** Images published for v1.0.x built but failed at startup.
- **Member magic-link login** no longer returns 500.
- **Admin session persists across page reloads.**
- Docker builds for admin and portal (missing workspace dependencies).

### Changed

- API is bundled with esbuild; base image `node:22-alpine`; CI on Node 22 (Node 20 is EOL).

### Breaking changes

- API keys no longer access `/admin/*`.
- `X-Program-Id` different from the key's program → 403.
- `/metrics` requires `METRICS_TOKEN` (returns 404 in production when unset).
- `GIFTCARD_HMAC_SECRET` is required in production.
- `VITE_API_KEY` and `VITE_PROGRAM_ID` were removed from the admin build.

### Upgrade notes

1. Run database migrations (`prisma migrate deploy`): adds `MEMBER` to `AuditActorType`.
2. Set `GIFTCARD_HMAC_SECRET` and (to scrape metrics) `METRICS_TOKEN`; configure Prometheus to send `Authorization: Bearer <METRICS_TOKEN>`.
3. Deactivate or rotate the `dev-key` API key if it exists, and rotate any key that was used in an admin build.
4. Rebuild the admin UI without `VITE_API_KEY` / `VITE_PROGRAM_ID`.
5. Review the audit log for `/admin/*` actions performed by `API_KEY` actors (see the advisory).

### Known limitations

- **MCP server:** its admin tools call routes that do not exist in the API and do not work in this release (#48).
- Points ledger concurrency fixes from #29 are not included in this release.

## [1.0.0] - 2026-05-21 — Initial Public Release

### Core Platform

- **Points Engine** — immutable ledger with accumulate, redeem, expire, adjust, and reverse operations. Idempotency-key support for safe retries. Rule-based multipliers, pending/confirmed balance tracking, configurable expiry.
- **Multi-Tenant** — program-scoped data isolation enforced at the API layer via `X-API-Key` + `X-Program-Id` headers.
- **REST API** — Fastify 4 + Zod validation + Swagger docs. Rate limiting, CORS, Helmet security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy). 50+ endpoints across stats, members, campaigns, coupons, segments, badges, tiers, rewards, auth, notifications, and coalition.
- **Admin Dashboard** — React 18 + Vite + shadcn/ui + TanStack Query. KPI cards, member management, campaign builder (6-step wizard), segment builder (visual rule editor), coupon generator, badges/tiers editor, rewards catalog, and coalition configuration.
- **Magic-Link Auth** — passwordless login via email (Resend). No passwords stored or transmitted. Session cookies with httpOnly, secure, sameSite strict.
- **Security** — Zod validation on every boundary, per-endpoint rate limiting (auth: 5/min, accumulate: 30/min, redeem: 20/min), CORS whitelist, Helmet defaults, HMAC-SHA256 webhook signing with 5-min timestamp tolerance, Handlebars sandbox with prototype stripping, AES-256-GCM credential encryption.

### Engagement

- **Campaigns** — 8 types (Bonus Points, Spend & Get, Frequency, Milestone, Referral, Birthday, Anniversary, Flash Sale, Tier Upgrade Bonus). Budget capping, stacking rules, A/B testing via CampaignVariant records, impact estimation.
- **Coupons** — 6 discount types (Percentage, Fixed, Free Product, Free Shipping, Extra Points, Experience), 3 modes (Shared, Individual, Limited), bulk generation, usage tracking.
- **Segments** — dynamic rule DSL with AND/OR groups and operators (eq, neq, gt, gte, lt, lte, between, contains, in), static lists, visual builder, real-time member count estimation.
- **Notifications** — multi-channel (Email, SMS, Push, In-App, Webhook), Handlebars templates with sandboxed rendering, provider abstraction (Resend, Twilio, OneSignal), opt-out per channel per member, webhook signing.

### Gamification

- **Badges** — 5 types (Achievement, Status, Temporal, Collectible, Social) with condition DSL, temporal operators (`count_in_window`, `within`, `since`), progress tracking (0-100%), event-driven auto-evaluation.
- **Tiers** — configurable rank hierarchy with threshold-based upgrades, inactivity downgrade job, progress-to-next-tier tracking, tier benefits, pyramid visualization.
- **Rewards** — 6 categories (Discount, Physical Product, Gift Card, Experience, Charity, Coalition Transfer), eligibility checks, stock management, idempotent redemption.
- **Customer Portal** — React PWA with magic-link auth, i18n (en/es), rewards catalog with wishlist, badges gallery with progress, transaction history, notification preferences.
- **Loyalty Widget** — embeddable Lit Web Component, mini/full modes, themeable via CSS custom properties, standalone sub-components, ~45 KB gzipped.

### Coalition

- **Generic Adapter Interface** — pluggable provider implementations with capability flags (accumulate, redeem, convert, reverseTransaction, historyQuery).
- **Apprecio Adapter** — full implementation against real API. MD5 form-data authentication, multi-country (MX, CL, PE, CO, EC), email/RUT identifier types, private token sanitization.
- **Two-Phase Commit** — PENDING → CONFIRMED/FAILED for all external operations. Compensation reversal on core failure.
- **Circuit Breaker** — opossum-based, opens after 5 consecutive failures within 10s, half-open after 30s, auto-closes after 3 successes.
- **Retry Logic** — exponential backoff (1s, 2s, 4s, max 3 attempts) for transient errors. Business errors never retried.
- **Credential Encryption** — AES-256-GCM at rest with KMS_MASTER_KEY support.
- **Admin Panel** — config page, transactions with detail timeline, linked members management, manual reconciliation.

### Security

- **Admin Auth (argon2id)** — Admin login replaced Lucia with direct argon2id password hashing (memory 19456 KiB, time 2, parallelism 1). Session tokens are opaque random values with expiry, stored in a dedicated `AdminSession` table.
- **Login Timing Equalization** — Invalid-email and wrong-password paths run the same argon2 verification (against a dummy hash when the email doesn't exist), preventing email enumeration via response latency.
- **Dependency Audit** — Full `pnpm audit --prod` reviewed. Fastify 4.x vulnerabilities documented with compensating controls (Zod validation, no sendWebStream usage). Docusaurus build-time issues tracked upstream.

### Production

- **Helm Chart** — 33 K8s resources with sub-charts (Bitnami PostgreSQL 16, Redis 7), HPA v2 (CPU + memory), Ingress (nginx + cert-manager), migrations Job (Helm hook), ServiceMonitor for Prometheus, PDB, NetworkPolicy, External Secrets Operator support. Auto-published to GitHub Pages via `chart-releaser-action`.
- **Observability** — OpenTelemetry tracing (HTTP, PostgreSQL, Redis auto-instrumentation), Prometheus metrics (HTTP RPS/latency/errors, BullMQ queue depth/duration/throughput, Node.js defaults), Grafana dashboards (API Overview, BullMQ Queues, Business Metrics).
- **Business KPIs** — 13 `loyaltyos_*` Prometheus metrics: points earned/redeemed/reversed/adjusted/expired, balance gauge, insufficient balance counter, coupons redeemed/created/discount histogram, coalition operations (by provider), circuit breaker state, and active members gauge. Wired via adapter pattern into PointsService, CouponsService, and CoalitionService.
- **Active Members Job** — Hourly scheduled job queries `lastActiveAt` (new column on Member) to set `loyaltyos_active_members_total` per program.
- **Standalone Worker** — BullMQ worker entry point for independent K8s scaling.
- **Docker Compose** — production stack with Prometheus + Grafana + OTEL Collector via `--profile monitoring`.
- **npm Package** — `@loyaltyos/widget` published to npm on every `v*` release. Lit Web Component with IIFE + ESM outputs (~45 KB gzipped).
- **CI/CD** — GitHub Actions: CI (build, typecheck, lint, test with PostgreSQL 14/15/16 matrix + Redis, Codecov upload), Docker (build + push to GHCR with `latest` tag for stable releases), Docs (Docusaurus deploy to GitHub Pages), Release (Helm publish to gh-pages, npm widget publish, GitHub Release with changelog), CodeQL (weekly + on PR), Smoke Test (Docker Compose health checks), Dependabot (npm weekly, Docker monthly, Actions weekly), CODEOWNERS, issue templates (bug/feature), PR template.
- **Documentation** — 27-page Docusaurus site across 7 sections. Custom logo and branding.

### Changed

- All package versions bumped from 0.1.0 to 1.0.0.
- README updated with deployment options, coalition spotlight, future roadmap, contributors/backers sections.
- Roadmap marked complete for all 5 phases.
- Security pass: dependency audit, security headers, rate limits, CORS lockdown, webhook timestamp validation, SECURITY.md.

## [0.4.0] - 2026-05-21

### Added

- **Coalition adapter (`packages/coalition`)** — generic adapter interface with pluggable provider implementations, optional capabilities flags (accumulate, redeem, convert, reverseTransaction, historyQuery), and two-phase commit pattern (PENDING → CONFIRMED/FAILED) for all external operations.
- **Apprecio adapter** — full implementation against the real Apprecio API with MD5 form-data authentication, multi-country base URLs (MX, CL, PE, CO, AR), email/RUT identifier types, private token sanitization in error messages, and configurable timeouts.
- **Coalition API endpoints** — member-facing routes for accumulate, redeem, convert, and reverse with Zod validation and idempotency-key support. Admin routes for config management (GET/PUT), healthcheck, link/unlink accounts, list transactions with filters, list linked accounts, and manual reconciliation.
- **Redis caching** — `getCachedExternalBalance` wrapper with 60s TTL and graceful degradation when Redis is unavailable.
- **Credential encryption** — AES-256-GCM encryption for coalition provider credentials stored in the database, with KMS_MASTER_KEY support and dev fallback.
- **Circuit breaker** — opossum-based circuit breaker per adapter: opens after 5 consecutive failures within 10s, half-open after 30s, auto-closes after 3 consecutive successes.
- **Retry logic** — exponential backoff (1s, 2s, 4s, max 3 attempts) for transient errors; business errors are never retried.
- **Error classification** — dedicated error types with HTTP status mappings: CoalitionConfigNotFoundError (404), CoalitionAccountNotLinkedError (404), CoalitionBusinessError (422), CoalitionTransientError (502), CoalitionCircuitOpenError (503), CoalitionUnsupportedError (501).
- **Coalition admin UI** — config page with provider selector, Apprecio-aware form (country dropdown, public/private tokens with reveal toggle, identifier type, timeouts), feature toggles with capability-based disabling, capabilities banner, test connection button, and save. Transactions page with status/type/member filters, paginated table, detail panel with timeline (PENDING → CONFIRMED/FAILED/REVERSED), and force reverse dialog. Linked members page with search, paginated table, and unlink confirmation dialog.
- **Documentation** — `docs/coalition-apprecio.md` with overview, auth scheme, action mapping, supported flows, configuration, limitations, sandbox checklist, and troubleshooting.

### Changed

- Admin sidebar now includes Coalition link for navigation to coalition configuration, transactions, and linked members pages.
- API error handler extended with 6 coalition error → HTTP status mappings.

### Added

- **Badges engine (`packages/badges`)** — 5 badge types (Achievement, Status, Temporal, Collectible, Social) with condition DSL, temporal operators (`count_in_window`, `within`, `since`), progress tracking (0-100%), and event-driven auto-evaluation.
- **Tiers engine (`packages/badges`)** — configurable rank hierarchy with threshold-based upgrades, inactivity downgrade job, progress-to-next-tier tracking, and tier benefits.
- **Badges admin API** — CRUD endpoints, manual award, member badge list with progress, badge distribution stats.
- **Tiers admin API** — CRUD, reorder, tier stats (member count per tier), member tier evaluation.
- **Badges admin UI** — list with type filter, editor with condition config, image upload.
- **Tiers admin UI** — list with inline editing, color picker, drag-to-reorder, pyramid visualization.
- **Rewards engine (`packages/rewards`)** — 6 categories (Discount, Physical Product, Gift Card, Experience, Charity, Coalition Transfer), eligibility checks (points, tier, stock), stock management, and idempotent redemption.
- **Rewards admin API** — CRUD, publish/archive, restock, redemptions history.
- **Rewards admin UI** — table/grid toggle view with category badges, editor, redemptions log.
- **Customer Portal (`apps/portal`)** — React 18 + Vite + Tailwind with magic-link auth (Lucia), i18n (en/es), home dashboard (balance, tier progress, top rewards, badges), rewards catalog with wishlist and category filter, reward detail with eligibility and redeem, badges gallery with progress, transaction history, profile with notification preferences, and PWA manifest.
- **Loyalty Widget (`apps/widget`)** — Lit Web Components: `<loyalty-widget>` (full/mini modes), `<loyalty-points-card>`, `<loyalty-tier-card>`, `<loyalty-rewards-top3>`, `<loyalty-badges-gallery>`. Themeable via CSS custom properties, sub-50 KB bundle.
- **Magic-link auth** — passwordless login via email magic links (Resend), session cookies, and public auth API endpoints.
- **Notification preferences & opt-out** — member-level channel preferences with opt-out check before send, device token registration for push.
- **Twilio SMS provider** — REST API integration with configurable API base URL.
- **OneSignal push provider** — REST API integration with configurable API base URL.
- **Notification test-send** — admin endpoint with memberId/recipient overrides, template preview with real member context.
- **Idempotency-key support** — on points accumulate, redeem, and adjust operations.
- **Audit trail** — discriminator-based actor tracking (API_KEY, MEMBER, ADMIN) for all admin operations.
- **CHANGELOG** — this file.

### Changed

- Widget refactored to support mini/full display modes per spec, sub-50 KB bundle.
- Auth plugin encapsulated via `fastify-plugin` for correct hook firing on all routes.
- Template variable context now includes `balance` alongside `points` for parity between triggers and test-send.

## [0.2.0] - 2026-05-16

### Added

- **Campaigns engine (`packages/campaigns`)** — 8 campaign types (Bonus Points, Spend & Get, Frequency, Milestone, Referral, Birthday, Anniversary, Flash Sale, Tier Upgrade) with budget capping, stacking rules, A/B testing, and impact estimation.
- **Campaigns admin API** — CRUD endpoints, lifecycle management (activate / pause / archive), and campaign-to-event matching pipeline.
- **Campaign Builder UI** — 6-step wizard (type → audience → rules → channels → dates → review) with impact estimation card.
- **Campaigns list UI** — table with type badge, status badge, budget, dates, and dropdown actions (edit, activate, pause, archive).
- **Coupons engine (`packages/coupons`)** — 6 discount types (Percentage, Fixed, Free Product, Free Shipping, Extra Points, Experience), 3 modes (Shared, Individual, Limited), usage tracking, expiry, and stacking control.
- **Coupons admin API** — CRUD, bulk generation, and real-time usage stats.
- **Coupons list UI** — table with mode filter, usage column (used/max), status badge, and delete action.
- **Coupon bulk generate UI** — form with prefix, count, length, discount config, channels, and schedule; generated codes displayed in scrollable grid with copy-to-clipboard.
- **Segments engine (`packages/segments`)** — dynamic rule DSL with operators (eq, neq, gt, gte, lt, lte, between, contains, in), recursive AND/OR groups, and segment materialization / evaluation.
- **Segments admin API** — CRUD, evaluate count, and member management (add/remove for static segments).
- **Segments list UI** — table with type filter (Dynamic / Static), member count, status, and edit/delete actions.
- **Segment Builder UI** — visual rule builder with Accordion groups, AND/OR toggle, field/operator/value condition rows, real-time member count estimation. Static mode with member ID textarea.
- **Notifications (`packages/notifications`)** — multi-channel delivery (Email, SMS, Push, In-App, Webhook), template rendering with `{{variable}}` dot-notation interpolation, provider abstraction (Resend, Courier, Noop, Log), and notification service with audit trail.
- **Admin sidebar navigation** — new links for Campaigns, Coupons, and Segments.
- **13 new shadcn/ui components** — Accordion, AlertDialog, Calendar, Checkbox, Command, DropdownMenu, Popover, Progress, RadioGroup, Switch, Tabs, Textarea, Tooltip.

## [0.1.0] - 2026-05-15

### Added

- **Monorepo scaffold** — Turborepo + pnpm workspaces with TypeScript strict, ESLint, Prettier, Husky, and commitlint.
- **Database schema** — Prisma ORM with full multi-tenant data model: programs, members, point accounts, immutable transaction ledger, tiers, campaigns, coupons, rewards, badges, coalition accounts, notifications, audit log, and webhooks.
- **Docker Compose** — local dev infrastructure with PostgreSQL 15, Redis 7, MailHog, and Adminer.
- **Points engine (`packages/core`)** — accumulate, redeem, expire, adjust, and reverse operations with idempotency-key support, rule-based multipliers, and pending/confirmed balance tracking.
- **REST API (`apps/api`)** — Fastify 5 with Zod validation, API key auth (multi-tenant via `X-Program-Id`), rate limiting, CORS, Swagger docs at `/docs`, and CRUD endpoints for members, events, stats, and balance queries.
- **Admin UI (`apps/admin`)** — React 18 + Vite + shadcn/ui + TanStack Query. Dashboard with KPI cards, member list with search and pagination, member detail with balance and transaction history, and manual point adjustments with idempotency-key support.
- **Seed script** — demo program with 12 members, 3 tiers, 2 campaigns, 2 coupons, 3 rewards, 2 badges, and realistic point transactions.
- **Widget scaffold (`apps/widget`)** — Vite + Lit project for embeddable loyalty widget (UI coming in Phase 3).
- **Documentation** — professional README with quick start, architecture overview, API reference, and roadmap. CONTRIBUTING.md with conventions and pull request checklist.

[1.3.0]: https://github.com/jvillatox/loyaltyos/compare/v1.2.0...v1.3.0
[1.4.0]: https://github.com/jvillatox/loyaltyos/compare/v1.3.0...v1.4.0
[1.4.1]: https://github.com/jvillatox/loyaltyos/compare/v1.4.0...v1.4.1
[1.5.0]: https://github.com/jvillatox/loyaltyos/compare/v1.4.1...v1.5.0
[1.6.0]: https://github.com/jvillatox/loyaltyos/compare/v1.5.0...v1.6.0
[1.7.0]: https://github.com/jvillatox/loyaltyos/compare/v1.6.0...v1.7.0
[1.8.0]: https://github.com/jvillatox/loyaltyos/compare/v1.7.0...v1.8.0
[1.9.0]: https://github.com/jvillatox/loyaltyos/compare/v1.8.0...v1.9.0
[1.9.1]: https://github.com/jvillatox/loyaltyos/compare/v1.9.0...v1.9.1

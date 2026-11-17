# Points Expiry — Design

> Status: **Design only** (issue #33). No code has been written yet. This document
> describes the target model and is the review artifact for the implementation.

## Summary of business rules

Per program, two settings control expiry:

- `expiryMode`: `NONE` | `INACTIVITY` | `PER_LOT`.
- `expiryMonths`: `1–60`.

Defaults:

- New programs → `INACTIVITY`, 12 months.
- Existing programs → `NONE` (nothing changes on upgrade).

Modes:

- **`INACTIVITY`** — if a member goes `expiryMonths` without activity (an earn or a
  redeem; admin adjustments do **not** count), their entire _spendable_ balance
  expires.
- **`PER_LOT`** — each lot expires `expiryMonths` after it is settled (made
  spendable).

Consumption rules:

- On redeem or a negative adjustment, the lots that expire first are consumed
  first; lots with no expiry (`expiresAt = null`) come last; ties break by the
  oldest lot first.
- Enabling or changing the mode never expires points retroactively: the deadline
  is frozen in each lot at the moment it is created, exactly like `availableAt`
  is frozen at earn time. Changing `expiryMonths` affects only new lots.
- A 30-day-before email reminder is sent once per expiry date, respecting member
  notification preferences.
- Portal and widget show "X points expire on <date>" when applicable.

The rest of this document grounds these rules in the existing code and specifies
the model, the invariant, concurrency, migration, jobs, and a three-PR rollout.

---

## 1. Lot model and per-operation behavior

### 1.1 `PointLot`

A lot is the unit of spendable points that shares one expiry deadline. Only
_spendable_ points live in lots; held points (`pendingBalance`) do **not** have a
lot until they settle.

```prisma
model PointLot {
  id             String    @id @default(cuid())
  accountId      String
  programId      String
  sourceTxId     String?   // originating credit tx (EARN / ADJUST / CONVERT_IN); null for the legacy migration lot
  originalAmount Int
  remaining      Int       // unspent units still in this lot
  expiresAt      DateTime? // null = never expires (NONE / legacy / admin credit)
  createdAt      DateTime  @default(now())

  account PointAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)

  @@index([accountId, expiresAt])
  @@index([accountId, createdAt])
  @@index([expiresAt])
}
```

`PointAccount` gains an explicit debt field (see §1.7 for why debt must be stored,
not derived):

```prisma
model PointAccount {
  // …existing fields…
  debt Int @default(0)
}
```

`Program` gains the two settings plus an enum:

```prisma
enum ExpiryMode {
  NONE
  INACTIVITY
  PER_LOT
}

model Program {
  // …existing fields…
  expiryMode   ExpiryMode @default(INACTIVITY)
  expiryMonths Int        @default(12)
}
```

`sourceTxId` is a plain `String?` (no FK), mirroring how `PointTransaction`
already stores `reversedFromId` / `reversedById` as plain strings. Keeping it
link-free avoids a heavier migration and lets the legacy lot point to nothing.

### 1.2 The invariant

```
balance = Σ(lot.remaining) − debt
```

with `balance` and `debt` on the account, and `lot.remaining ≥ 0` for every lot.
`Σ(lot.remaining)` is never negative; `debt ≥ 0`.

### 1.3 `earn` — the lot is born when points become spendable

Today `PointsService.earn()` (`packages/core/src/service.ts:75`) writes one `EARN`
transaction and increments either `pendingBalance` (held) or `balance` (immediate).

With lots:

- **Immediate earn (`holdDays = 0`)** — `balance` is incremented **and** a lot is
  created with `remaining = amount`, `sourceTxId = EARN.id`, and
  `expiresAt` frozen now as:
  - `PER_LOT`: `now + expiryMonths`.
  - `NONE` / `INACTIVITY`: `null`.

- **Held earn (`holdDays > 0`)** — unchanged: points go to `pendingBalance`, no
  lot yet.

So the answer to "does the lot originate at settlement?" is **yes**: a held earn
produces its lot at settlement, not at earn time (see §1.4).

### 1.4 `settlePending` — held points become a lot at settlement

`settlePending()` (`service.ts:340`) moves an EARN from `pendingBalance` to
`balance` when `availableAt ≤ now`. Under the new model it also **creates the
lot** for the settled amount.

The expiry deadline must be deterministic, not dependent on when the hourly
worker happens to run. So the lot's `expiresAt` is frozen from the already-frozen
`availableAt`, not from `now`:

- `PER_LOT`: `expiresAt = availableAt + expiryMonths`.
- `NONE` / `INACTIVITY`: `null`.

This is the "frozen like `availableAt`" property: `availableAt` is frozen at earn
time (`service.ts:85`), and `expiresAt` is frozen from it at settlement.

### 1.5 `redeem` — consume lots FIFO

`redeem()` (`service.ts:137`) currently decrements `balance` with a balance-checked
`updateMany` and writes a `REDEEM`. Under the new model it additionally consumes
lots in FIFO order (§1.9), decrementing `remaining` until the redeemed amount is
covered. Because the invariant holds, the sum of decremented `remaining` always
equals the amount (a redeem can never be satisfied by debt — it is rejected by
the balance check before lots are touched).

### 1.6 `adjust` — positive creates a lot, negative consumes like redeem

`adjust()` (`service.ts:194`) increments or decrements `balance` directly.

- **Positive adjustment** — a lot is created with `expiresAt = null` (admin
  credits do not carry a per-lot deadline). If `debt > 0`, the credit first
  repays debt and only the surplus becomes a lot (§1.7).
- **Negative adjustment** — identical to redeem: consume lots FIFO.

### 1.7 `reverse` of an EARN — consume its own lot, shortfall becomes debt

This is the "option A" policy from #36 (the behaviour `reverse()` already has:
reversing already-spent points takes the balance negative, with an audit trail).

`reverse()` (`service.ts:244`) currently computes `effect = applyTxToBalance(type,
amount)` and decrements `pendingBalance` (unsettled) or `balance` (settled).

Under the new model:

- **Reversing an unsettled (held) EARN** — points are still pending, no lot
  exists. Unchanged: decrement `pendingBalance`.

- **Reversing a settled EARN** — the EARN's lot has `remaining = R ≤ amount`.
  The reversal consumes the whole lot (`R → 0`), and the already-spent part
  becomes debt:

  ```
  balance  -= amount
  debt     += (amount − R)
  ```

  This keeps the invariant: `Σ(remaining)` drops by `R`, `debt` rises by
  `amount − R`, so `balance` drops by exactly `amount`.

**Why debt is stored, not derived.** A member can hold a surviving lot _and_ owe
debt at the same time: earn 100 (lot A) + earn 100 (lot B), redeem 150 (lot A →
0, lot B → 50), then reverse the first earn of 100 (lot A already empty →
`debt = 100`). Now `balance = −50`, `Σ(remaining) = 50`, `debt = 100`. Because
`debt` can exceed `−balance`, it cannot be recovered from `balance` alone and must
be its own column.

**New lots pay debt first.** When `debt > 0`, any credit (earn, positive
adjustment, `CONVERT_IN`) first reduces debt; only the surplus becomes a lot:

```
debtAfter = max(0, debt − amount)
lotAmount = max(0, amount − debt)
balance  += amount
```

### 1.8 `expire`

The current `expire()` (`service.ts:375`) expires individual `EARN` transactions
past a legacy `expiresAt`, clamped to `max(balance, 0)`. That per-EARN mechanism
is superseded by the lot model (`EarnInput.expiresAt` is not set anywhere in the
main earn flow today). Expiry becomes lot-driven:

- **`PER_LOT`** — for each lot with `expiresAt ≤ now` and `remaining > 0`: write an
  `EXPIRE` transaction for `remaining`, set `remaining → 0`, and
  `balance -= remaining`. No "clamp to zero": the invariant already guarantees
  `Σ(remaining) = balance + debt`, so removing a lot's `remaining` keeps
  `balance ≥ −debt`, which is a valid (negative) balance.

- **`INACTIVITY`** — for each account whose last activity (latest `EARN` or
  `REDEEM` transaction) is older than `expiryMonths` and whose `balance > 0`:
  expire the whole spendable balance — set every lot's `remaining → 0` and
  `balance → −debt` (i.e. to `0` when there is no debt). Held points
  (`pendingBalance`) are **not** spendable and are left alone; if they later
  settle while the member is still inactive, the next daily run wipes them too,
  because settlement is not activity.

### 1.9 FIFO ordering

The consumption order for redeem / negative adjustment is:

```
ORDER BY expiresAt ASC NULLS LAST, createdAt ASC
```

i.e. soonest-expiring first, never-expiring lots last, and within the same
deadline the oldest lot first.

---

## 2. The invariant and `verifyConsistency()`

`verifyConsistency()` (`packages/core/src/ledger.ts:31`) replays the transaction
ledger and compares against `balance` / `pendingBalance`, splitting on
`settledAt` (the hold-aware fix from #35). That part is unchanged.

The lot model adds a second check. Given the account's lots, debt, and balance:

```
totalRemaining = Σ(lot.remaining)
expectedBalance = totalRemaining − debt
```

A valid account satisfies **both**:

1. `expectedBalance === balance` (the lot/debt invariant), **and**
2. the existing ledger replay still matches `balance` and `pendingBalance`.

The verification routine is extended to accept the lots and `debt` and report the
lot invariant as its own error line, e.g.
`Lot invariant mismatch: Σremaining=… debt=… expected=… actual=…`.

---

## 3. Concurrency — serializing on the account row

Today `redeem()` relies on an optimistic, balance-checked `updateMany`
(`service.ts:150`) and `expire()` already uses `SELECT … FOR UPDATE`
(`service.ts:391`). A lot-consumption path cannot stay optimistic: two concurrent
redeems could both read the same lots and both decrement them.

The rule: **every operation that touches lots must first lock the account row**
with `SELECT … FOR UPDATE` inside the same transaction, then read/consume lots.
Because all balance-changing operations on an account share that row lock, they
serialize and cannot double-consume the same lot.

Concretely, `redeem` becomes:

```
$transaction:
  rows = SELECT id, balance, debt FROM "PointAccount" WHERE id = $accountId FOR UPDATE
  if rows[0].balance < amount → throw InsufficientBalanceError
  lots = SELECT … FROM "PointLot" WHERE accountId = $accountId AND remaining > 0
         ORDER BY expiresAt ASC NULLS LAST, createdAt ASC
         FOR UPDATE
  decrement lots' remaining in order until `amount` is covered
  update PointAccount: balance -= amount, totalRedeemed += amount
  create REDEEM transaction
```

The account row lock is the primary serialization point; the lot-level
`FOR UPDATE` is defense in depth. `settlePending`, `expire`, `adjust`, and
`reverse` follow the same pattern (lock account → mutate lots → update account →
write the ledger row), which is already the shape of `expire()`.

---

## 4. Data migration

Today nothing expires, so the migration must reproduce the current state exactly:

For every `PointAccount`:

- `balance > 0` → one **legacy lot**:
  `{ accountId, programId, sourceTxId = null, originalAmount = balance, remaining = balance, expiresAt = null }`,
  and `debt = 0`.
- `balance = 0` → no lot, `debt = 0`.
- `balance < 0` → no lot, `debt = −balance` (already-negative balances today are
  only reachable via the existing reverse-of-spent-points path).

`pendingBalance` is untouched: held points get their lot when `settlePending`
runs (§1.4).

Why this is equivalent: existing programs are migrated to `expiryMode = NONE`, so
every lot (including legacy lots) has `expiresAt = null` and never expires. The
invariant `balance = Σ(remaining) − debt` holds at rest, and consumption-only
behaviour (no expiry yet, in PR A) preserves today's semantics exactly.

`Program` is migrated the same way `holdDays` was (#34): schema default
`INACTIVITY` / `12`, with an explicit backfill setting **existing** programs to
`expiryMode = NONE`.

---

## 5. Jobs

Both jobs reuse the existing BullMQ repeat setup in
`apps/api/src/lib/points-job-setup.ts` (`points.settle-pending` hourly,
`points.expire` daily `0 4 * * *`). They must be idempotent when two API/worker
instances run at once.

### 5.1 Daily expiry

Extends `points.expire` (§1.8). Idempotency comes from the data, not the queue:

- `PER_LOT`: the per-lot mutation is guarded by `UPDATE … WHERE remaining > 0`
  (a re-run finds `remaining = 0` and skips), and the `EXPIRE` ledger row uses a
  deterministic idempotency key `expire-${lot.id}` so a re-run cannot write a
  second `EXPIRE` for the same lot.
- `INACTIVITY`: same "remaining → 0" guard across all of an account's lots, plus
  a deterministic key (e.g. `expire-inactivity-${account.id}`) on the single
  `EXPIRE` transaction that wipes the balance.

### 5.2 30-day reminder (deduplicated)

A second daily job (or a step in the expiry job) finds what expires in ~30 days
and emails once per expiry date.

A small dedup table gives "once per expiry date" idempotently:

```prisma
model PointExpiryReminder {
  id         String   @id @default(cuid())
  memberId   String
  programId  String
  expiresOn  DateTime // the exact expiry date being reminded about
  sentAt     DateTime @default(now())

  @@unique([memberId, programId, expiresOn])
}
```

Flow:

1. Compute upcoming deadlines:
   - `PER_LOT`: lots with `expiresAt` in `(now, now + 30d]`, grouped by
     `(memberId, expiresAt)`.
   - `INACTIVITY`: per account, `expiryDate = lastActivityAt + expiryMonths`;
     include when `expiryDate` is in `(now, now + 30d]`.
2. For each `(memberId, expiresOn)`, attempt to insert a `PointExpiryReminder`
   row. A unique-violation (P2002) means the reminder was already sent → skip.
3. On success, send the email through the notifications system
   (`sendTrigger(programId, "points.expiry_reminder", memberId, {…})`).

Idempotency across instances: two workers race on the `INSERT`; the unique
constraint lets exactly one win, so the email is "at least once, deduplicated".
The notification itself respects `MemberNotificationPreferences` because the
template is non-transactional and `checkOptOut()` (`notifications/src/service.ts:194`)
skips it for members who opted out of the EMAIL channel. The expiry email uses a
new `triggerEvent` value (`points.expiry_reminder`) with a per-program, per-locale
template, following the existing template lookup chain.

---

## 6. Rollout plan (three PRs)

### PR A — lots, migration, and consumption (no expiry yet)

Behaviour-neutral groundwork: every lot has `expiresAt = null`, so nothing ever
expires, but all balance movement now goes through lots.

- Add `PointLot`, `PointAccount.debt`, and the `ExpiryMode` / `expiryMonths`
  fields (schema default `INACTIVITY`/`12`; existing programs backfilled to
  `NONE`).
- Legacy-lot data migration (§4).
- Rework `earn`, `settlePending`, `redeem`, `adjust`, and `reverse` to create and
  consume lots, keep the invariant, and serialize on the account row.
- Extend `verifyConsistency()` with the lot/debt check.
- Leave `expire()` effectively inert (no lots have a non-null `expiresAt`).

Tests:

- Earn (immediate and held) creates a lot with the right `remaining`; held earn
  creates no lot until `settlePending`.
- `settlePending` creates the lot at settlement.
- Redeem consumes lots in FIFO order (soonest-expiring first, never-expiring
  last, oldest-on-tie).
- Positive adjustment creates a never-expiring lot; negative adjustment consumes
  FIFO.
- Reversing a settled EARN consumes its own lot and turns the shortfall into
  `debt`; reversing an unsettled EARN only touches `pendingBalance`.
- Debt and a surviving lot coexist; a new credit repays debt before creating a
  lot.
- The invariant `balance = Σ(remaining) − debt` holds after every operation.
- `verifyConsistency` flags a lot/balance mismatch and a lot/debt mismatch.
- Concurrency: two concurrent redeems of the same account cannot double-consume
  (account-row lock serializes them).
- Existing `packages/core` tests (ledger, service, hold-days) still pass
  unchanged semantics.

### PR B — expiry modes, admin config, and portal/widget dates

- Freeze `expiresAt` at lot creation from the program mode and `expiryMonths`
  (§1.3–1.4).
- Rewrite `expire()` for `PER_LOT` and `INACTIVITY`, and wire it into the daily
  worker (§5.1).
- Admin: program-settings fields for mode and months (1–60, with the "no
  retroactive expiry" behaviour documented).
- Balance API: expose the nearest expiry date / amount so the portal and widget
  can render "X points expire on <date>".
- Portal and widget: render that line when applicable.

Tests:

- `PER_LOT`: a settled lot expires exactly `expiryMonths` after its frozen
  `availableAt`; expiry writes an `EXPIRE` ledger row and sets `remaining → 0`.
- `INACTIVITY`: an account with no earn/redeem for `expiryMonths` loses its whole
  spendable balance; an admin adjustment does **not** count as activity; held
  points are left alone and are wiped on the next run if still inactive.
- Enabling or switching mode never expires retroactively (deadline frozen in the
  lot).
- Changing `expiryMonths` affects only lots created after the change.
- Admin validation rejects `expiryMonths` outside 1–60.
- `NONE` never expires anything.
- Portal/widget show the expiry line only when applicable, localized.

### PR C — 30-day email reminders

- Add `PointExpiryReminder` and its unique constraint.
- The deduplicated reminder job (§5.2).
- Notification template wiring for the `points.expiry_reminder` trigger.

Tests:

- A reminder is sent once per `(member, expiry date)`; a second run skips.
- Two concurrent runs send at most one email (unique-constraint race).
- Members who opted out of EMAIL receive nothing (`SKIPPED_OPT_OUT`).
- `PER_LOT` groups multiple lots sharing one expiry date into a single reminder.
- `INACTIVITY` reminds 30 days before `lastActivityAt + expiryMonths`.

---

## Open questions

1. **`expiresAt` source for held points** — §1.4 freezes `expiresAt = availableAt
   - expiryMonths`for determinism. The alternative is`settledAt + expiryMonths`
     (drifts with worker scheduling). Confirm the deterministic choice.
2. **`INACTIVITY` and `pendingBalance`** — held points are excluded from an
   inactivity wipe until they settle; they are then wiped on the next run if the
   member is still inactive. Confirm this is the intended reading of "saldo
   disponible".
3. **Legacy per-EARN `PointTransaction.expiresAt`** — superseded by lots. Whether
   to drop the column and `EarnInput.expiresAt` in a follow-up, or leave it inert.

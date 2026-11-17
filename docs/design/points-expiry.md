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
  expiresAt      DateTime? // null = never expires (NONE / legacy / held-settled under NONE)
  createdAt      DateTime  @default(now())

  account PointAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, expiresAt])
  @@index([accountId, createdAt])
  @@index([expiresAt])
}
```

`PointAccount` gains an explicit debt field and a cached last-activity timestamp:

```prisma
model PointAccount {
  // …existing fields…
  debt          Int       @default(0)
  lastActivityAt DateTime?
}
```

`Program` gains the two settings, an enum, and the timestamp that anchors
non-retroactive activation (§1.10):

```prisma
enum ExpiryMode {
  NONE
  INACTIVITY
  PER_LOT
}

model Program {
  // …existing fields…
  expiryMode      ExpiryMode @default(INACTIVITY)
  expiryMonths    Int        @default(12)
  expiryChangedAt DateTime   @default(now())
}
```

`sourceTxId` is a plain `String?` (no FK), mirroring how `PointTransaction`
already stores `reversedFromId` / `reversedById` as plain strings. Keeping it
link-free avoids a heavier migration and lets the legacy lot point to nothing.

### 1.2 The invariant

```
balance = Σ(lot.remaining) − debt
```

with `balance` and `debt` on the account, `lot.remaining ≥ 0` for every lot, and
`debt ≥ 0`. `Σ(lot.remaining)` is never negative.

The model also enforces a tighter implication:

```
debt > 0  ⇒  Σ(lot.remaining) = 0
```

i.e. an account can owe debt **or** hold unspent lots, never both at once. This is
preserved because every credit repays debt before creating a lot (§1.7) and every
reversal drains all lots before creating debt (§1.7). A consequence is that debt
is always recoverable as `max(0, −balance)`; the column is kept anyway so the
reverse algorithm and the migration backfill stay explicit rather than implied by
sign conventions.

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

- Both cases set `PointAccount.lastActivityAt = now` (an earn is activity).

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

Settlement is **not** activity: `settlePending` does not touch `lastActivityAt`.

### 1.5 `redeem` — consume lots FIFO

`redeem()` (`service.ts:137`) currently decrements `balance` with a balance-checked
`updateMany` and writes a `REDEEM`. Under the new model it additionally consumes
lots in FIFO order (§1.9), decrementing `remaining` until the redeemed amount is
covered. Because the invariant holds, the sum of decremented `remaining` always
equals the amount (a redeem can never be satisfied by debt — it is rejected by
the balance check before lots are touched).

A redeem sets `PointAccount.lastActivityAt = now` (a redeem is activity).

### 1.6 `adjust` — positive creates a lot, negative consumes like redeem

`adjust()` (`service.ts:194`) increments or decrements `balance` directly.

- **Positive adjustment** — a lot is created with `expiresAt` from the program
  rule at the time of the adjustment, exactly like an earn:
  - `PER_LOT`: `now + expiryMonths`.
  - `NONE` / `INACTIVITY`: `null`.
    If `debt > 0`, the credit first repays debt and only the surplus becomes a lot
    (§1.7).
- **Negative adjustment** — identical to redeem: consume lots FIFO.

Adjustments do **not** count as activity, so `adjust()` never touches
`lastActivityAt`.

### 1.7 `reverse` of an EARN — consume own lot, then other lots, then debt

This is the "option A" policy from #36 (the behaviour `reverse()` already has:
reversing already-spent points takes the balance negative, with an audit trail).

`reverse()` (`service.ts:244`) currently computes `effect = applyTxToBalance(type,
amount)` and decrements `pendingBalance` (unsettled) or `balance` (settled).

Under the new model:

- **Reversing an unsettled (held) EARN** — points are still pending, no lot
  exists. Unchanged: decrement `pendingBalance`. No `lastActivityAt` change
  (reversal is not activity).

- **Reversing a settled EARN** — the reversal must remove `amount` of spendable
  value. It consumes value in a fixed order until `amount` is covered, and only
  what remains becomes debt:
  1. Consume the EARN's own lot (`remaining → 0`), if it still has any.
  2. If more is needed, consume the remaining lots in FIFO order
     (`ORDER BY expiresAt ASC NULLS LAST, createdAt ASC`), the same order as
     redeem.
  3. If still more is needed, increase `debt` by the shortfall.

  ```
  balance   -= amount
  own lot     → 0                       (if it existed)
  other lots  → decremented FIFO        (until amount is covered)
  debt       += shortfall               (only what lots could not cover)
  ```

Because lots are fully drained before debt is created, the implication
`debt > 0 ⇒ Σ(lot.remaining) = 0` is preserved.

**Example.** Earn 100 (lot A) + earn 100 (lot B): `balance = 200`,
`Σ(remaining) = 200`, `debt = 0`. Redeem 150: lot A → 0, lot B → 50
(`balance = 50`, `Σ(remaining) = 50`). Reverse the first earn (100):

- own lot A `remaining = 0` → consumes 0;
- other lots FIFO: lot B `remaining = 50` → consumes 50;
- shortfall `100 − 0 − 50 = 50` → `debt = 50`.

Result: `balance = −50`, `Σ(remaining) = 0`, `debt = 50`. The invariant holds
(`0 − 50 = −50`), and `debt > 0 ⇒ Σ(remaining) = 0`.

**New lots pay debt first.** When `debt > 0`, any credit (earn, positive
adjustment, `CONVERT_IN`) first reduces debt; only the surplus becomes a lot:

```
debtAfter = max(0, debt − amount)
lotAmount = max(0, amount − debt)
balance  += amount
```

This keeps `Σ(remaining) = 0` while any debt remains, so the implication holds.

### 1.8 `expire`

The current `expire()` (`service.ts:375`) expires individual `EARN` transactions
past a legacy `expiresAt`, clamped to `max(balance, 0)`. That per-EARN mechanism
is superseded by the lot model. Expiry becomes lot-driven:

- **`PER_LOT`** — for each lot with `expiresAt ≤ now` and `remaining > 0`: write an
  `EXPIRE` transaction for `remaining`, set `remaining → 0`, and
  `balance -= remaining`. No "clamp to zero": the invariant already guarantees
  `Σ(remaining) = balance + debt`, so removing a lot's `remaining` keeps
  `balance ≥ −debt`, which is a valid (negative) balance.

- **`INACTIVITY`** — for each account with `balance > 0` whose
  `lastActivityAt` is older than the inactivity deadline
  `max(lastActivityAt, expiryChangedAt) + expiryMonths` (§1.10): expire the whole
  spendable balance — set every lot's `remaining → 0` and `balance → 0` (the wipe
  only runs when `balance > 0`, which under the invariant implies `debt = 0`).
  Held points (`pendingBalance`) are **not** spendable and are left alone; if
  they later settle while the member is still inactive, the next daily run wipes
  them too, because settlement is not activity.

### 1.9 FIFO ordering

The consumption order for redeem / negative adjustment / reverse shortfall is:

```
ORDER BY expiresAt ASC NULLS LAST, createdAt ASC
```

i.e. soonest-expiring first, never-expiring lots last, and within the same
deadline the oldest lot first.

### 1.10 Non-retroactive activation (mode and months changes)

`Program.expiryChangedAt` is bumped to `now()` whenever `expiryMode` **or**
`expiryMonths` changes. It is the anchor that guarantees a change never expires
points retroactively.

- **`INACTIVITY` deadline** is always
  `max(lastActivityAt, expiryChangedAt) + expiryMonths`. Because `expiryChangedAt`
  is set when the mode is switched on, an account gets the full `expiryMonths`
  from the moment of activation, regardless of how long it was already inactive.
  Changing `expiryMonths` under `INACTIVITY` likewise restarts the window at the
  change (nobody's already-accrued inactivity is counted against the new value).

- **`PER_LOT` activation** (`NONE → PER_LOT`, or `INACTIVITY → PER_LOT`): existing
  lots carry `expiresAt = null` (they were created under a non-lot mode).
  Activation backfills every `null` lot to `expiryChangedAt + expiryMonths`, so
  they get the full window from activation. Lots created after activation get
  `now + expiryMonths` as usual.

- **`PER_LOT → NONE` or `PER_LOT → INACTIVITY`**: existing lots' `expiresAt` is
  set to `null` (they no longer expire per-lot). Under `INACTIVITY`, expiry is
  then governed by the inactivity deadline above.

- **`expiryMonths` change under `PER_LOT`**: affects only new lots. Existing lots
  keep their frozen `expiresAt`; `expiryChangedAt` is still bumped for
  consistency but does not rewrite frozen deadlines.

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

A valid account satisfies **all** of:

1. `expectedBalance === balance` (the lot/debt invariant),
2. `debt > 0 ⇒ totalRemaining === 0` (the tightened implication), **and**
3. the existing ledger replay still matches `balance` and `pendingBalance`.

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
  update PointAccount: balance -= amount, totalRedeemed += amount, lastActivityAt = now
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

`lastActivityAt` is backfilled per account as the `MAX(createdAt)` of that
account's `EARN` and `REDEEM` transactions, or `null` if it has none.

Why this is equivalent: existing programs are migrated to `expiryMode = NONE`, so
every lot (including legacy lots) has `expiresAt = null` and never expires. The
invariant `balance = Σ(remaining) − debt` holds at rest for all three cases
(positive → `balance = balance − 0`; zero → `0 = 0 − 0`; negative →
`−balance = 0 − balance`), and consumption-only behaviour (no expiry yet, in
PR A) preserves today's semantics exactly.

`Program` is migrated the same way `holdDays` was (#34): schema defaults
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
   - `INACTIVITY`: per account,
     `expiryDate = max(lastActivityAt, expiryChangedAt) + expiryMonths`; include
     when `expiryDate` is in `(now, now + 30d]`.
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

- Add `PointLot`, `PointAccount.debt` + `PointAccount.lastActivityAt`, and the
  `ExpiryMode` / `expiryMonths` / `expiryChangedAt` fields (schema defaults
  `INACTIVITY`/`12`; existing programs backfilled to `NONE`).
- Legacy-lot data migration (§4), including the `lastActivityAt` backfill.
- Rework `earn`, `settlePending`, `redeem`, `adjust`, and `reverse` to create and
  consume lots, keep the invariant, and serialize on the account row.
- Extend `verifyConsistency()` with the lot/debt checks.
- Leave `expire()` effectively inert (no lots have a non-null `expiresAt`).

Tests:

- Earn (immediate and held) creates a lot with the right `remaining`; held earn
  creates no lot until `settlePending`.
- `settlePending` creates the lot at settlement.
- Redeem consumes lots in FIFO order (soonest-expiring first, never-expiring
  last, oldest-on-tie).
- Positive adjustment creates a lot following the program rule; negative
  adjustment consumes FIFO.
- Reversing a settled EARN consumes its own lot and turns the shortfall into
  `debt`; reversing an unsettled EARN only touches `pendingBalance`.
- Reversing a settled EARN whose own lot is empty **consumes other lots FIFO
  before creating debt** (the shortfall only becomes debt once every remaining
  lot is drained).
- Debt and a surviving lot never coexist: a new credit repays debt before
  creating a lot, and the implication `debt > 0 ⇒ Σremaining = 0` holds.
- The invariant `balance = Σ(remaining) − debt` holds after every operation.
- `verifyConsistency` flags a lot/balance mismatch and a lot/debt mismatch.
- Migration over a v1.7.0 database with positive, zero, and negative balances
  leaves the invariant valid on every account.
- Concurrency: two concurrent redeems of the same account cannot double-consume
  (account-row lock serializes them); the test is run **20 consecutive times**
  without failure.
- Existing `packages/core` tests (ledger, service, hold-days) still pass
  unchanged semantics.

### PR B — expiry modes, admin config, and portal/widget dates

- Freeze `expiresAt` at lot creation from the program mode and `expiryMonths`
  (§1.3–1.4).
- Implement the non-retroactive activation rules (§1.10) on mode/months changes.
- Rewrite `expire()` for `PER_LOT` and `INACTIVITY`, and wire it into the daily
  worker (§5.1).
- Admin: program-settings fields for mode and months (1–60, with the "no
  retroactive expiry" behaviour documented).
- Balance API: expose the nearest expiry date / amount so the portal and widget
  can render "X points expire on <date>".
- Portal and widget: render that line when applicable.
- Drop the superseded legacy per-EARN expiry: remove `PointTransaction.expiresAt`
  and `EarnInput.expiresAt`.

Tests:

- `PER_LOT`: a settled lot expires exactly `expiryMonths` after its frozen
  `availableAt`; expiry writes an `EXPIRE` ledger row and sets `remaining → 0`.
- `INACTIVITY`: an account with no earn/redeem for `expiryMonths` loses its whole
  spendable balance; an admin adjustment does **not** count as activity; held
  points are left alone and are wiped on the next run if still inactive.
- Enabling or switching mode never expires retroactively (the deadline is frozen
  in the lot; `INACTIVITY` uses `max(lastActivityAt, expiryChangedAt)`).
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
- `INACTIVITY` reminds 30 days before `max(lastActivityAt, expiryChangedAt) +
expiryMonths`.

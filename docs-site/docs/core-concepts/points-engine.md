---
sidebar_position: 3
title: Points Engine
---

# Points Engine

The points engine (`packages/core`) is the heart of LoyaltyOS. It manages the complete lifecycle of loyalty points with an immutable ledger, idempotency guarantees, and multi-currency support.

## Core Operations

| Operation   | Description                                              | Idempotent |
| ----------- | -------------------------------------------------------- | ---------- |
| Accumulate  | Add points to a member's account from an event or rule   | Yes        |
| Redeem      | Deduct points from a member's account (reward or coupon) | Yes        |
| Expire      | Remove points that reached their expiration date         | No         |
| Adjust      | Manual admin adjustment (always creates an AuditLog)     | Yes        |
| Reverse     | Contra-entry that negates a previous transaction         | Yes        |
| Convert Out | Transfer own points to an external coalition system      | Yes        |
| Convert In  | Receive points from an external coalition system         | Yes        |

## Immutable Ledger

All point movements are recorded in the `PointTransaction` table. Transactions are **never deleted** — reversals use contra-entries that reference the original transaction via `reversedFromId`.

This design provides:

- Complete audit trail
- Ability to reconstruct any balance at any point in time
- Compliance with accounting standards

## Idempotency

Critical operations require an `Idempotency-Key` header. If the same key is used twice, the system returns the result of the first operation without re-executing. This makes retries safe.

```
POST /api/v1/members/:id/adjust
Headers: Idempotency-Key: unique-key-123
Body: { points: 500, reason: "Customer service credit" }
```

## Point Rules

Point rules determine how points are awarded for specific event types:

| Field        | Description                                         |
| ------------ | --------------------------------------------------- |
| `eventType`  | The event that triggers the rule (e.g., `purchase`) |
| `multiplier` | Point multiplier (can be fractional, e.g., 1.5x)    |
| `conditions` | JSON criteria that must match for the rule to apply |
| `startsAt`   | When the rule becomes active                        |
| `endsAt`     | When the rule expires                               |

Example: "2x points on weekend purchases in the premium category"

```json
{
  "eventType": "purchase",
  "multiplier": 2.0,
  "conditions": {
    "category": "premium",
    "dayOfWeek": ["saturday", "sunday"]
  }
}
```

## Expiry

Points can expire in two modes:

- **Rolling expiry** — points expire N days after being earned
- **Fixed date** — all points expire on a specific calendar date

The expiry worker runs periodically and sweeps past-due point transactions, creating EXPIRE contra-entries.

## Balance State

Each `PointAccount` tracks:

- `balance` — confirmed spendable points
- `pendingBalance` — earned but not yet settled (e.g., within a return window)
- `totalEarned` — lifetime points earned
- `totalRedeemed` — lifetime points redeemed

## Event Processing

External systems emit events (purchase, registration, referral) via the API:

```
POST /api/v1/events
Body: { type: "purchase", memberId: "...", amount: 5000, idempotencyKey: "..." }
```

The system:

1. Validates the event
2. Checks idempotency
3. Matches applicable point rules
4. Creates EARN transactions
5. Updates the member's point account
6. Triggers any downstream effects (campaign matching, badge evaluation, notifications)

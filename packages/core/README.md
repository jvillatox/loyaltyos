# @loyaltyos/core

Points engine and business rules for LoyaltyOS. The heart of the loyalty platform.

## Features

- **Immutable ledger** — all point movements are recorded as transactions; nothing is ever deleted
- **Idempotent operations** — `Idempotency-Key` protects against duplicate processing
- **Rule engine** — configurable multipliers that match on event type and conditions
- **Double-entry reversals** — contra-entries for corrections, not destructive deletes
- **Expiration** — automatic sweep of expired points

## Usage

```typescript
import { PointsService } from "@loyaltyos/core";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const points = new PointsService(prisma);

// Earn points (applies active rules)
const earnResult = await points.earn({
  memberId: "member-1",
  programId: "prog-1",
  amount: 1000,
  source: "purchase",
  idempotencyKey: "tx-unique-key",
});
console.log(earnResult.balanceAfter); // 1100 (with 1.1x multiplier)

// Redeem points
const redeemResult = await points.redeem({
  memberId: "member-1",
  programId: "prog-1",
  amount: 200,
  source: "reward-claim",
  idempotencyKey: "redeem-unique",
});

// Check balance
const balance = await points.balance("member-1", "prog-1");
console.log(balance); // { confirmed: 900, pending: 0, total: 900 }
```

## API Reference

### `new PointsService(prisma: PrismaClient)`

Create a points service backed by the given Prisma client.

### `earn(input: EarnInput): Promise<EarnResult>`

Record an EARN transaction. Applies active `PointRule` records matching the event type
and conditions. The `idempotencyKey` ensures replaying the same key returns the existing
result without creating a duplicate.

### `redeem(input: RedeemInput): Promise<RedeemResult>`

Redeem points. Throws `InsufficientBalanceError` if the account balance is too low.

### `adjust(input: AdjustInput): Promise<AdjustResult>`

Manual admin adjustment. Requires `adminUserId` and a `reason` (stored in description).

### `reverse(txId: string, reason: string, adminUserId: string): Promise<ReverseResult>`

Reverse a previous transaction with a contra-entry. Throws `TransactionNotFoundError`
or `AlreadyReversedError` if the transaction doesn't exist or was already reversed.

### `expire(programId: string): Promise<number>`

Sweep expired EARN transactions for a program. Returns the count of transactions expired.

### `balance(memberId: string, programId: string): Promise<Balance>`

Get the current balance. Returns `{ confirmed, pending, total }`.

### `history(memberId: string, programId: string, pagination?: PaginationParams): Promise<PaginatedResult<PointTransaction>>`

Get paginated transaction history for a member.

## Errors

| Error class                | When                                    |
| -------------------------- | --------------------------------------- |
| `InsufficientBalanceError` | Redeem amount exceeds confirmed balance |
| `TransactionNotFoundError` | Reverse target doesn't exist            |
| `AlreadyReversedError`     | Transaction was already reversed        |
| `InvalidRuleError`         | Rule configuration is invalid           |

## Ledger Guarantees

- Every point movement creates exactly one `PointTransaction` row
- Reversals are new rows (type `REVERSE`) — the original row is never modified or deleted
- `idempotencyKey` is unique across all transactions — same key always returns the same result
- Balance is recalculable from the transaction sequence — `verifyConsistency()` validates chains

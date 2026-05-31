# @loyaltyos/giftcards

Gift card engine for LoyaltyOS. Generate, validate, redeem, refund, and cancel stored-value gift cards with concurrency-safe balance tracking.

## Features

- **Batch generation** — create batches of unique, checksum-protected codes (up to 1M per batch)
- **Multi-use redemption** — partial redemptions with decreasing balance tracked to the cent
- **Decimal money math** — all monetary amounts use `Prisma.Decimal(12,2)` for precise arithmetic
- **Redis-based locking** — per-code owner-token locks prevent race conditions on concurrent redemptions
- **Idempotency** — `Idempotency-Key` header with payload-hash verification catches replay tampering
- **Streaming export** — CSV/XLSX batch export via `csv-stringify` and `exceljs` stream writers
- **Expiration processing** — paginated daily job marks expired cards and records expire transactions
- **Terms templates** — reusable T&C templates with automatic versioning on update

## Usage

```typescript
import { GiftCardService, createRedisLocks } from "@loyaltyos/giftcards";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis();

const giftCards = new GiftCardService(prisma, {
  codeSecret: process.env.GIFTCARD_HMAC_SECRET,
});

// Create a batch (enqueues background code generation)
const batch = await giftCards.createBatch({
  programId: "prog-1",
  name: "Holiday Cards",
  quantity: 1000,
  initialAmount: 500,
  currency: "MXN",
  expirationDate: new Date("2026-12-31"),
  termsTemplateId: "terms-1",
});

// Public: validate a code
const result = await giftCards.validateCode({ code: "ABCD-EFGH-JKLM-NPQR" });
console.log(result.valid); // true
console.log(result.balance); // 500
console.log(result.currency); // "MXN"

// Redeem (requires lock + idempotency key)
const redeem = await giftCards.redeem(
  {
    code: "ABCD-EFGH-JKLM-NPQR",
    amount: 150,
    idempotencyKey: "idem-abc-123",
    orderRef: "order-42",
  },
  createRedisLocks(redis),
);
console.log(redeem.balanceAfter); // 350
console.log(redeem.idempotent); // false

// Same key returns cached result
const replay = await giftCards.redeem(
  { code: "ABCD-EFGH-JKLM-NPQR", amount: 150, idempotencyKey: "idem-abc-123" },
  createRedisLocks(redis),
);
console.log(replay.idempotent); // true
```

## API Reference

### `new GiftCardService(prisma, options?)`

Create a gift card service. Options:

- `codeSecret` — HMAC secret for code checksums (required in production, defaults to `"dev-secret"`)
- `metrics` — `GiftCardsServiceMetrics` for Prometheus instrumentation
- `enqueueGenerate` — callback to enqueue batch code generation jobs

### Batches

| Method                            | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `createBatch(input)`              | Create a batch and enqueue code generation. Throws `TermsTemplateNotFoundError`. |
| `getBatch(id)`                    | Get batch details. Throws `GiftCardBatchNotFoundError`.                          |
| `listBatches(programId, filters)` | Paginated list with optional `status` filter.                                    |
| `cancelBatch(id)`                 | Cancel a pending/generating batch. Throws `BatchNotCancellableError`.            |
| `generateBatchCodes(batchId)`     | Worker callback — generates all codes for a batch.                               |

### Cards

| Method                             | Description                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `validateCode({ code })`           | Public validation. Checksum-first, DB only on match. Returns `{ valid, balance?, reason? }`.           |
| `redeem(input, acquireLock)`       | Redeem amount. Requires idempotency key and Redis lock. Returns `RedeemResult`.                        |
| `refund(input, acquireLock)`       | Refund amount (capped at `initialAmount`). Returns `RedeemResult`. Throws `RefundExceedsInitialError`. |
| `cancelCard(input, acquireLock)`   | Cancel a card, zero out balance, record cancel transaction.                                            |
| `getTransactions(cardId, filters)` | Paginated transaction history with optional `type` filter.                                             |

### Expiration

| Method                  | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `processExpiredCards()` | Find and expire all cards past their expiration date. Returns count. |

### Terms Templates

| Method                           | Description                                                |
| -------------------------------- | ---------------------------------------------------------- |
| `createTermsTemplate(input)`     | Create a new T&C template.                                 |
| `getTermsTemplate(id)`           | Get a template by id. Throws `TermsTemplateNotFoundError`. |
| `listTermsTemplates(programId)`  | List all templates for a program.                          |
| `updateTermsTemplate(id, input)` | Create a new version row with bumped version number.       |
| `deleteTermsTemplate(id)`        | Soft-delete (sets `isActive = false`).                     |

### Metrics

| Method                     | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `getMetrics(programId)`    | Active card count and outstanding balance.           |
| `getOutstandingBalances()` | Outstanding balance grouped by program and currency. |

## Errors

| Error class                        | When                                                | HTTP |
| ---------------------------------- | --------------------------------------------------- | ---- |
| `GiftCardNotFoundError`            | Code doesn't exist in DB                            | 404  |
| `GiftCardBatchNotFoundError`       | Batch id doesn't exist                              | 404  |
| `GiftCardInvalidCodeError`         | Code fails checksum validation                      | 400  |
| `GiftCardExpiredError`             | Card is past its `expirationDate`                   | 422  |
| `GiftCardCancelledError`           | Card status is `cancelled`                          | 422  |
| `GiftCardInsufficientBalanceError` | Balance below requested amount                      | 422  |
| `GiftCardNotActiveError`           | Card status is not `active` or `partially_redeemed` | 422  |
| `GiftCardLockError`                | Could not acquire Redis lock (concurrent operation) | 409  |
| `GiftCardIdempotencyConflictError` | Same idempotency key with different payload         | 409  |
| `BatchNotCancellableError`         | Batch has redeemed cards or is in a terminal status | 409  |
| `RefundExceedsInitialError`        | Refund would push balance above `initialAmount`     | 422  |
| `TermsTemplateNotFoundError`       | Terms template id doesn't exist                     | 404  |

## Code Design

Gift card codes are 16 characters (plus optional prefix) with embedded checksums:

- **Body**: 12 random characters from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous chars: 0/O, 1/I/L)
- **Checksum**: HMAC-SHA256 first 4 chars encoded as base32
- **Display format**: `XXXX-XXXX-XXXX-CHCK` (dash-separated groups of 4)

Checksums allow the public `validateCode` endpoint to reject invalid codes without a database lookup. A dummy DB lookup is performed on bad checksums to equalize response timing.

## Locking

Redis locks use the owner-token pattern:

- `SET giftcard:lock:{code} <token> EX 30 NX` to acquire
- Lua script `GET == token ? DEL` to release
- Prevents accidentally releasing another process's lock

## Database Constraints

All monetary columns use `@db.Decimal(12,2)`. Additional CHECK constraints:

- `GiftCard.balance >= 0`
- `GiftCard.balance <= initialAmount`
- `GiftCard.initialAmount > 0`
- `GiftCardTransaction.amount >= 0`

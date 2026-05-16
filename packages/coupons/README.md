# @loyaltyos/coupons

Coupon engine for LoyaltyOS. Create, validate, and redeem discount coupons.

## Features

- **Multiple modes** — `SHARED` (unlimited uses), `INDIVIDUAL` (one per code), `LIMITED` (max uses)
- **Flexible discounts** — percentage, fixed amount, free product, free shipping, extra points, experiences
- **Validation pipeline** — date range, usage caps, per-member limits, minimum purchase, channel restrictions
- **Bulk code generation** — generate thousands of unique codes with a configurable prefix
- **Audit trail** — every redemption recorded as a `CouponRedemption` row

## Usage

```typescript
import { CouponsService } from "@loyaltyos/coupons";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const coupons = new CouponsService(prisma);

// Create a coupon
const coupon = await coupons.create({
  programId: "prog-1",
  code: "SUMMER20",
  mode: "SHARED",
  discountType: "PERCENTAGE",
  discountValue: 20,
  maxUses: 500,
  maxUsesPerMember: 1,
});

// Validate without redeeming
const result = await coupons.validate("SUMMER20", {
  memberId: "mem-1",
  purchaseAmount: 5000,
  channel: "online",
});
console.log(result.valid); // true
console.log(result.discountAmount); // 1000

// Validate and redeem in one call
const redemption = await coupons.redeem("SUMMER20", {
  memberId: "mem-1",
  purchaseAmount: 5000,
});
console.log(redemption.redemptionId); // "red-abc123"

// Generate bulk codes
const codes = await coupons.generateCodes({
  programId: "prog-1",
  prefix: "VIP",
  count: 100,
  length: 8,
  discountType: "FIXED",
  discountValue: 1000,
});
```

## API Reference

### `new CouponsService(prisma: PrismaClient)`

Create a coupons service backed by the given Prisma client.

### `create(input: CouponCreateInput): Promise<Coupon>`

Create a single coupon. Throws `CouponCodeDuplicateError` if the code already exists in the program.

### `update(id: string, input: CouponUpdateInput): Promise<Coupon>`

Partial update of coupon fields. Throws `CouponNotFoundError` if the id doesn't exist.

### `delete(id: string): Promise<void>`

Soft-delete a coupon (sets `deletedAt`). Throws `CouponNotFoundError`.

### `getById(id: string): Promise<Coupon>`

Fetch a single coupon by id. Throws `CouponNotFoundError`.

### `getByCode(programId: string, code: string): Promise<Coupon>`

Fetch a coupon by code within a program. Throws `CouponNotFoundError`.

### `list(programId: string, filters): Promise<PaginatedResult<Coupon>>`

List coupons with pagination and filters. Supports `isActive`, `mode`, `page`, `pageSize`.

### `validate(code: string, context: CouponValidateContext): Promise<ValidateResult>`

Validate a coupon without redeeming. Returns `{ valid, coupon, discountAmount, reason? }`.
Throws domain errors for specific failures (expired, exhausted, etc.).

### `redeem(code: string, context: CouponValidateContext): Promise<RedeemResult>`

Validate and redeem a coupon atomically. Records a redemption row and increments the usage counter.

### `generateCodes(input: GenerateCodesInput): Promise<string[]>`

Generate unique random alphanumeric codes. Automatically retries on collisions.

### `stats(id: string): Promise<CouponStats>`

Get usage statistics: `usedCount`, `remaining`, `isActive`.

## Errors

| Error class                | When                                        | HTTP |
| -------------------------- | ------------------------------------------- | ---- |
| `CouponNotFoundError`      | Coupon code or id doesn't exist             | 404  |
| `CouponCodeDuplicateError` | Code already exists in the program          | 409  |
| `CouponExpiredError`       | Coupon has passed its `expiresAt` date      | 422  |
| `CouponNotStartedError`    | Coupon is before its `startsAt` date        | 422  |
| `CouponExhaustedError`     | Global usage limit (`maxUses`) reached      | 422  |
| `CouponMemberLimitError`   | Per-member usage limit (`maxUsesPerMember`) | 422  |
| `CouponMinPurchaseError`   | Purchase amount below `minPurchase`         | 422  |
| `CouponChannelError`       | Channel not in the allowed `channels` list  | 422  |

## Discount Types

| Type            | `discountValue` meaning                   |
| --------------- | ----------------------------------------- |
| `PERCENTAGE`    | Percentage off (20 = 20%)                 |
| `FIXED`         | Fixed amount in cents (500 = $5.00)       |
| `FREE_PRODUCT`  | Free product (no value needed)            |
| `FREE_SHIPPING` | Free shipping (no value needed)           |
| `EXTRA_POINTS`  | Bonus points awarded                      |
| `EXPERIENCE`    | Non-monetary experience (no value needed) |

# @loyaltyos/rewards

Rewards catalog with eligibility checks, stock tracking, and redemption.

## Usage

```typescript
import { RewardsService } from "@loyaltyos/rewards";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rewards = new RewardsService(prisma);
```

### Create a reward

```typescript
const reward = await rewards.create({
  programId: "prog_001",
  name: "10% off next purchase",
  description: "Get 10% off your next online order",
  pointsCost: 500,
  stock: 100, // null = unlimited
  imageUrl: "https://cdn.example.com/reward.png",
  category: "DISCOUNT_FUTURE",
  tierRequired: "Gold", // only Gold+ members can redeem
});
```

### List rewards with filters

```typescript
const { items, total } = await rewards.list("prog_001", {
  isActive: true,
  category: "PHYSICAL_PRODUCT",
  minPoints: 100,
  maxPoints: 2000,
  tierRequired: "Silver",
  page: 1,
  pageSize: 10,
});
```

### Check eligibility

```typescript
const { eligible, reason, reward } = await rewards.checkEligibility("reward_123", "mem_001");

if (!eligible) {
  console.log(`Cannot redeem: ${reason}`);
  // e.g., "Insufficient points: need 500, have 200"
}
```

### Redeem a reward

```typescript
import { generateIdempotencyKey } from "@loyaltyos/core";

const result = await rewards.redeem("reward_123", "mem_001", generateIdempotencyKey());

console.log(`Spent ${result.redemption.pointsSpent} pts`);
console.log(`New balance: ${result.transaction.balanceAfter}`);
```

### Restock

```typescript
const updated = await rewards.restock("reward_123", 50);
console.log(`Stock is now: ${updated.stock}`);
```

### Archive / Publish / Soft-delete

```typescript
await rewards.archive("reward_123");
await rewards.publish("reward_123");
await rewards.softDelete("reward_123");
```

## Categories

| Constant             | Description                              |
| -------------------- | ---------------------------------------- |
| `DISCOUNT_FUTURE`    | Discount on next purchase                |
| `PHYSICAL_PRODUCT`   | Physical item with inventory             |
| `GIFT_CARD`          | Gift card (own or third-party)           |
| `EXPERIENCE`         | Event, service, or access                |
| `CHARITY_DONATION`   | Donation to a cause                      |
| `COALITION_TRANSFER` | Transfer points to an external coalition |

## Errors

All errors extend `Error` with a descriptive message:

| Class                           | Trigger                            |
| ------------------------------- | ---------------------------------- |
| `RewardNotFoundError`           | Reward ID does not exist           |
| `RewardNotActiveError`          | Reward is not published            |
| `RewardOutOfStockError`         | Stock is zero (or decrement raced) |
| `RewardTierInsufficientError`   | Member tier is too low             |
| `RewardInsufficientPointsError` | Member does not have enough points |

## Idempotency

Redemption supports idempotency keys. If the same key is reused, the service returns the previously recorded result without deducting points twice.

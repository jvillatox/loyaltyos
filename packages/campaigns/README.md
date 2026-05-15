# @loyaltyos/campaigns

Campaign engine for LoyaltyOS. Create and manage incentive campaigns with rule-based targeting, A/B testing, and budget controls.

## Installation

Part of the LoyaltyOS monorepo. No standalone install needed.

## Usage

```typescript
import { CampaignsService } from "@loyaltyos/campaigns";
import { PointsService } from "@loyaltyos/core";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const points = new PointsService(prisma);
const campaigns = new CampaignsService(prisma, points);
```

### Create a campaign

```typescript
const campaign = await campaigns.create({
  programId: "prog_1",
  name: "Double Points Weekend",
  type: "BONUS_POINTS",
  multiplier: 2,
  maxBudget: 100000,
  startsAt: new Date("2026-06-01"),
  endsAt: new Date("2026-06-03"),
  conditions: {
    all: [{ field: "category", in: ["electronics", "fashion"] }],
  },
});
```

### Create an A/B test campaign

```typescript
const abCampaign = await campaigns.create({
  programId: "prog_1",
  name: "Summer Promo A/B Test",
  type: "BONUS_POINTS",
  multiplier: 3,
  abTesting: true,
  variants: [
    { name: "Control", trafficPct: 50 },
    { name: "Variant B", trafficPct: 50, config: { headline: "Earn 3x!" } },
  ],
});
```

### Evaluate campaigns for an event

```typescript
const evaluation = await campaigns.evaluateForEvent({
  type: "purchase",
  memberId: "mem_123",
  programId: "prog_1",
  amount: 500,
  payload: { category: "electronics" },
});

console.log(evaluation.applicable.length, "campaigns match");
console.log(evaluation.variantAssignments);
```

### Apply a campaign

```typescript
const result = await campaigns.applyCampaign("camp_1", {
  type: "purchase",
  memberId: "mem_123",
  programId: "prog_1",
  amount: 500,
});
// result.pointsAwarded, result.applicationId, result.variantId
```

### Lifecycle management

```typescript
await campaigns.pause("camp_1");
await campaigns.activate("camp_1");
await campaigns.archive("camp_1");
```

### Estimate impact

```typescript
const estimate = await campaigns.estimateImpact({
  programId: "prog_1",
  multiplier: 2,
  maxBudget: 50000,
});
// { estimatedMembers: 1500, estimatedPoints: 300000, estimatedCost: 50000 }
```

## Campaign Types

| Type                 | Description               |
| -------------------- | ------------------------- |
| `BONUS_POINTS`       | Extra points multiplier   |
| `SPEND_AND_GET`      | Spend X, earn Y bonus     |
| `FREQUENCY`          | Visit N times in M days   |
| `MILESTONE`          | Reach spending milestone  |
| `REFERRAL`           | Refer a friend, both earn |
| `BIRTHDAY`           | Automatic birthday bonus  |
| `ANNIVERSARY`        | Membership anniversary    |
| `FLASH_SALE`         | Short-window incentive    |
| `TIER_UPGRADE_BONUS` | Bonus on tier promotion   |

## Rule DSL

Campaign conditions use a recursive JSON DSL:

```json
{
  "all": [
    { "field": "category", "in": ["electronics"] },
    { "field": "amount", "gte": 100 }
  ],
  "any": [
    { "field": "channel", "eq": "app" },
    { "field": "channel", "eq": "web" }
  ]
}
```

**Operators:** `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `in`, `between`, `contains`

## API

### CampaignsService

| Method                             | Description                                            |
| ---------------------------------- | ------------------------------------------------------ |
| `create(input)`                    | Create campaign with optional variants                 |
| `update(id, input)`                | Update campaign fields                                 |
| `activate(id)`                     | Activate a paused campaign                             |
| `pause(id)`                        | Pause an active campaign                               |
| `archive(id)`                      | Soft-delete (sets deletedAt)                           |
| `evaluateForEvent(event)`          | Returns applicable campaigns with eligibility metadata |
| `applyCampaign(campaignId, event)` | Execute campaign effect + record application           |
| `estimateImpact(input)`            | Projected members and points before activation         |

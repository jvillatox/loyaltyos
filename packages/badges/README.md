# @loyaltyos/badges

Badges and tiers engine for LoyaltyOS. Award gamification badges and manage loyalty tier progression based on member activity.

## Features

- **Five badge types** — ACHIEVEMENT, STATUS, TEMPORAL, COLLECTIBLE, SOCIAL
- **Condition DSL** — extensible rule evaluator with temporal operators (`within`, `since`, `count_in_window`)
- **Progress tracking** — 0-100% per badge with current/target values and remaining counts
- **Tier evaluation** — automatic upgrade/downgrade based on earned points, with progress to next tier
- **Event-driven** — plugs into the event pipeline; evaluates only relevant badges per event type
- **Nightly recompute** — inactivity downgrade job (members with no events in 90 days)
- **Pyramid stats** — tier distribution and badge unlock counts for admin dashboards

## Usage

```typescript
import { BadgesService, TiersService } from "@loyaltyos/badges";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);
```

### Create an ACHIEVEMENT badge

```typescript
// Awarded when a member spends $10,000 or more
const bigSpender = await badges.create({
  programId: "prog_dev",
  name: "Big Spender",
  description: "Spent $10,000 or more",
  type: "ACHIEVEMENT",
  imageUrl: "https://cdn.example.com/badges/big-spender.png",
  conditions: {
    all: [{ field: "totalSpent", gte: 10000 }],
  },
});
```

```typescript
// Awarded after 5 purchases in the last 30 days
const frequentBuyer = await badges.create({
  programId: "prog_dev",
  name: "Frequent Buyer",
  description: "Made 5+ purchases in 30 days",
  type: "ACHIEVEMENT",
  conditions: {
    count_in_window: {
      eventType: "purchase",
      days: 30,
      gte: 5,
    },
  },
});
```

```typescript
// Awarded to members who joined 90+ days ago and spent $500+
const loyalMember = await badges.create({
  programId: "prog_dev",
  name: "Loyal Member",
  description: "Member for 90+ days with $500+ spent",
  type: "STATUS",
  conditions: {
    all: [
      { field: "daysSinceJoined", gte: 90 },
      { field: "totalSpent", gte: 500 },
    ],
  },
});
```

### Award a badge manually (COLLECTIBLE or SOCIAL)

```typescript
// Manually award a badge (no conditions required)
await badges.award("mem-1", "badge-1", "admin");
```

### Configure tiers with criteria

```typescript
// Create tier hierarchy (higher rank = higher tier)
const bronze = await tiers.create({
  programId: "prog_dev",
  name: "Bronze",
  rank: 1,
  minPoints: 0, // entry tier
  color: "#cd7f32",
  benefits: {
    cashback: "1%",
    freeShipping: false,
  },
});

const silver = await tiers.create({
  programId: "prog_dev",
  name: "Silver",
  rank: 2,
  minPoints: 5000, // reached at 5,000 earned points
  color: "#c0c0c0",
  benefits: {
    cashback: "2%",
    freeShipping: true,
  },
});

const gold = await tiers.create({
  programId: "prog_dev",
  name: "Gold",
  rank: 3,
  minPoints: 20000,
  color: "#ffd700",
  benefits: {
    cashback: "3%",
    freeShipping: true,
    prioritySupport: true,
  },
});
```

### Reorder tiers

```typescript
// Pass tier IDs in desired rank order (1-based)
await tiers.reorder("prog_dev", [gold.id, silver.id, bronze.id]);
```

### Evaluate a member's tier

```typescript
const result = await tiers.evaluateMember("mem-1", "prog_dev");

if (result.changed && result.direction === "upgrade") {
  console.log(`Upgraded from ${result.previousTier?.name} to ${result.currentTier?.name}`);
}
console.log(`Progress to next tier: ${result.pointsProgress}%`);
console.log(`Points needed: ${result.pointsToNext}`);
```

### Get member badges with progress

```typescript
const memberBadges = await badges.getMemberBadges("mem-1");

for (const bp of memberBadges) {
  console.log(`${bp.badge.name}: ${bp.progress}% unlocked=${String(bp.unlocked)}`);
}
```

### Get a member's current tier

```typescript
const currentTier = await tiers.getCurrentTier("mem-1");
console.log(currentTier?.name ?? "No tier");
```

### Check tier benefits

```typescript
const perks = await tiers.benefits("gold-tier-id");
console.log(perks); // { cashback: "3%", freeShipping: true, prioritySupport: true }
```

## Pipeline Integration

Badges and tiers evaluate automatically after points-earn events in the API pipeline
(`apps/api/src/routes/events.ts`):

1. Points are earned via `points.accumulate()`
2. **Tier evaluation**: `tiers.evaluateMember(memberId, programId)` — if the member crossed a
   tier threshold, a `tier.changed` notification fires
3. **Badge evaluation**: `badges.evaluateOnEvent(event)` — only badges whose conditions
   reference the event type (or `totalSpent`/`totalEarned`/`eventCounts`) are evaluated.
   If conditions are met, the badge is unlocked and a `badge.unlocked` notification fires

Both evaluations are fire-and-forget (failures are logged but do not block the earn response).

### Nightly recompute

Run periodically to downgrade inactive members:

```typescript
const { downgraded, total } = await tiers.recomputeAll("prog_dev");
console.log(`Downgraded ${downgraded} of ${total} members`);
```

## Condition DSL

Badge conditions extend the segments rule DSL with temporal operators:

### Standard operators

```json
{
  "all": [
    { "field": "totalSpent", "gte": 10000 },
    { "field": "totalEarned", "gte": 5000 }
  ],
  "any": [
    { "field": "tags", "contains": "vip" },
    { "field": "currentTier", "in": ["Gold", "Platinum"] }
  ]
}
```

### Temporal operators

| Operator          | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `count_in_window` | Count events of a type in a rolling window (e.g. last 30 days) |
| `within`          | Check if member has any events within a time window            |
| `since`           | Check membership duration condition                            |

**`count_in_window` example** — badge unlocked when member has 10+ purchases in 30 days:

```json
{
  "count_in_window": {
    "eventType": "purchase",
    "days": 30,
    "gte": 10
  }
}
```

**`within` example** — badge requires activity in the last 7 days:

```json
{
  "within": { "days": 7 }
}
```

### Available context fields

| Field                | Type     | Description                        |
| -------------------- | -------- | ---------------------------------- |
| `totalSpent`         | number   | Earned minus redeemed              |
| `totalEarned`        | number   | Lifetime earned points             |
| `totalRedeemed`      | number   | Lifetime redeemed points           |
| `currentBalance`     | number   | Available point balance            |
| `currentTier`        | string   | Active tier name (e.g. "Gold")     |
| `tags`               | string[] | Member tags                        |
| `joinedAt`           | date     | Membership start date              |
| `daysSinceJoined`    | number   | Computed: days since joined        |
| `daysSinceLastEvent` | number   | Computed: days since last activity |
| `eventCounts`        | object   | Map of event type → count          |
| `email`              | string   | Member email                       |
| `phone`              | string   | Member phone                       |
| `firstName`          | string   | Member first name                  |
| `lastName`           | string   | Member last name                   |

## Badge types

| Type        | Description                                |
| ----------- | ------------------------------------------ |
| ACHIEVEMENT | Unlocked by meeting specific criteria      |
| STATUS      | Reflects a member's current status         |
| TEMPORAL    | Available for a limited time only          |
| COLLECTIBLE | Part of a collectible series               |
| SOCIAL      | Earned through social or community actions |

## API Reference

### `BadgesService`

| Method                                   | Description                                       |
| ---------------------------------------- | ------------------------------------------------- |
| `create(input)`                          | Create a badge                                    |
| `update(id, input)`                      | Partial update. Throws `BadgeNotFoundError`       |
| `delete(id)`                             | Soft-delete (sets `isActive = false`)             |
| `getById(id)`                            | Get a single badge. Throws `BadgeNotFoundError`   |
| `list(programId, filters?)`              | Paginated list with type/active/search filters    |
| `evaluateForMember(memberId, programId)` | Evaluate all active badges for a member           |
| `evaluateOnEvent(event)`                 | Evaluate badges relevant to a specific event type |
| `progress(memberId, badgeId)`            | Get progress for a single badge for a member      |
| `award(memberId, badgeId, source)`       | Manually award a badge                            |
| `getMemberBadges(memberId)`              | All badges with progress for a member             |
| `stats(programId)`                       | Badge distribution (unlock counts)                |

### `TiersService`

| Method                                | Description                                         |
| ------------------------------------- | --------------------------------------------------- |
| `create(input)`                       | Create a tier. Throws `TierRankConflictError`       |
| `update(id, input)`                   | Partial update. Throws `TierNotFoundError`          |
| `delete(id)`                          | Delete a tier. Throws `TierNotFoundError`           |
| `getById(id)`                         | Get a single tier. Throws `TierNotFoundError`       |
| `list(programId)`                     | List tiers ordered by rank                          |
| `reorder(programId, tierIds)`         | Reorder tiers by passing IDs in rank order          |
| `evaluateMember(memberId, programId)` | Evaluate and assign correct tier for a member       |
| `recomputeAll(programId)`             | Nightly job: re-evaluate all members for downgrades |
| `benefits(tierId)`                    | Get tier benefits JSON                              |
| `getMemberTier(memberId, programId)`  | Get tier with progress (alias for `evaluateMember`) |
| `getCurrentTier(memberId)`            | Lightweight current tier lookup (no re-evaluation)  |
| `stats(programId)`                    | Tier distribution (member count per tier)           |

## Errors

| Error class                | When                                         | HTTP |
| -------------------------- | -------------------------------------------- | ---- |
| `BadgeNotFoundError`       | Badge id does not exist                      | 404  |
| `BadgeAlreadyAwardedError` | Manual award when already unlocked           | 409  |
| `TierNotFoundError`        | Tier id does not exist                       | 404  |
| `TierRankConflictError`    | Another tier already uses the requested rank | 409  |

## Database

Requires `Badge`, `MemberBadge`, `Tier`, and `MemberTier` models from the LoyaltyOS Prisma
schema. The service uses the same repository pattern as `@loyaltyos/segments`:

```
TiersService / BadgesService
  └── Repository (data access)
        └── PrismaClient
```

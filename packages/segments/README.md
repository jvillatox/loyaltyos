# @loyaltyos/segments

Customer segmentation engine for LoyaltyOS. Define dynamic and static audiences for campaign targeting and notifications.

## Features

- **Dynamic segments** — rule-based membership evaluated in real time against member attributes
- **Static segments** — manually managed member lists (CSV import or API)
- **Rule DSL** — composable `all` / `any` conditions with operators: eq, neq, gt, lt, in, between, contains
- **Hybrid evaluation** — in-memory for single-member checks, database queries for batch operations
- **Computed fields** — `totalSpent` (earned minus redeemed), `currentTier` (active tier name)

## Usage

```typescript
import { SegmentsService } from "@loyaltyos/segments";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const segments = new SegmentsService(prisma);

// Create a dynamic segment for VIP customers
const segment = await segments.create({
  programId: "prog-1",
  name: "VIP Customers",
  type: "DYNAMIC",
  rules: {
    all: [
      { field: "totalSpent", gte: 50000 },
      { field: "currentTier", in: ["Gold", "Platinum"] },
    ],
  },
});

// Check if a member belongs
const result = await segments.evaluate("mem-1", segment.id);
console.log(result.belongsTo); // true or false

// Get all members in the segment
const { items, total } = await segments.getMembers(segment.id, { page: 1, pageSize: 50 });
console.log(`${total} VIP members`);

// Create a static segment
const staticSeg = await segments.create({
  programId: "prog-1",
  name: "Manual List",
  type: "STATIC",
  memberIds: ["mem-1", "mem-2", "mem-3"],
});

// Add members to a static segment
await segments.addMembers(staticSeg.id, ["mem-4", "mem-5"]);

// Preview segment size
const count = await segments.count(segment.id);
console.log(`Segment has ${count} members`);
```

## API Reference

### `new SegmentsService(prisma: PrismaClient)`

Create a segments service backed by the given Prisma client.

### `create(input: SegmentCreateInput): Promise<SegmentRow>`

Create a segment. Dynamic segments require `rules`; static segments accept optional `memberIds`.

### `update(id: string, input: SegmentUpdateInput): Promise<SegmentRow>`

Partial update of segment fields. Throws `SegmentNotFoundError`.

### `delete(id: string): Promise<void>`

Deactivate a segment (sets `isActive = false`). Throws `SegmentNotFoundError`.

### `getById(id: string): Promise<SegmentRow>`

Fetch a single segment. Throws `SegmentNotFoundError`.

### `list(programId: string, filters?): Promise<PaginatedResult<SegmentRow>>`

List segments with pagination and optional filters (`type`, `isActive`, `search`).

### `evaluate(memberId: string, segmentId: string): Promise<SegmentEvaluationResult>`

Check if a member belongs to a segment. Returns `{ belongsTo: boolean }`. Throws `SegmentNotFoundError` or `SegmentNotActiveError`.

### `getMembers(segmentId: string, pagination?): Promise<PaginatedResult<MemberWithComputedFields>>`

Get paginated member list for a segment. For dynamic segments, evaluates rules against all program members.

### `count(segmentId: string): Promise<number>`

Count members in a segment. For static segments, returns `memberIds.length`.

### `addMembers(segmentId: string, memberIds: string[]): Promise<SegmentRow>`

Add members to a static segment. Throws `SegmentNotStaticError` for dynamic segments.

### `removeMembers(segmentId: string, memberIds: string[]): Promise<SegmentRow>`

Remove members from a static segment. Throws `SegmentNotStaticError`.

## Rule DSL

Segments use the same rule DSL structure as campaigns:

```json
{
  "all": [
    { "field": "totalSpent", "gte": 10000 },
    { "field": "currentTier", "in": ["Gold", "Platinum"] }
  ],
  "any": [
    { "field": "tags", "contains": "vip" },
    { "field": "email", "contains": "@partner.com" }
  ]
}
```

### Supported fields

| Field         | Type     | Operators                          |
| ------------- | -------- | ---------------------------------- |
| `totalSpent`  | number   | eq, neq, gt, gte, lt, lte, between |
| `currentTier` | string   | eq, neq, in                        |
| `tags`        | string[] | contains                           |
| `joinedAt`    | date     | eq, gt, gte, lt, lte, between      |
| `email`       | string   | eq, neq, contains                  |
| `phone`       | string   | eq, neq, contains                  |
| `firstName`   | string   | eq, neq, contains                  |
| `lastName`    | string   | eq, neq, contains                  |

### Operators

| Operator   | Description                     |
| ---------- | ------------------------------- |
| `eq`       | Equal to                        |
| `neq`      | Not equal to                    |
| `gt`       | Greater than                    |
| `gte`      | Greater than or equal           |
| `lt`       | Less than                       |
| `lte`      | Less than or equal              |
| `in`       | Value in array                  |
| `between`  | Between two values `[min, max]` |
| `contains` | String contains substring       |

## Errors

| Error class               | When                                        | HTTP |
| ------------------------- | ------------------------------------------- | ---- |
| `SegmentNotFoundError`    | Segment id doesn't exist                    | 404  |
| `SegmentNotActiveError`   | Operation on inactive segment               | 422  |
| `SegmentNotStaticError`   | addMembers/removeMembers on dynamic segment | 422  |
| `InvalidSegmentRuleError` | Rule field can't be converted to DB query   | 422  |

## Rule Evaluation Strategy

**Single member** (`evaluate`): Loads the member, point account, and tier data, then evaluates rules in-memory. Fast for individual checks.

**Batch query** (`getMembers` / `count`): Uses a hybrid approach:

- Rules with only direct fields (`email`, `tags`, `currentTier`, etc.) are converted to Prisma `where` clauses for efficient database filtering
- Rules with computed fields (like `totalSpent`) require loading all program members and filtering in-memory

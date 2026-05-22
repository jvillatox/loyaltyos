---
sidebar_position: 1
title: Core
---

# Core (`@loyaltyos/core`)

Points engine — the heart of LoyaltyOS. Manages the complete lifecycle of loyalty points with an immutable ledger.

## Features

- Accumulate, redeem, expire, adjust, and reverse operations
- Idempotency-key support for safe retries
- Rule-based point multipliers (1.5x, 2x, fractional)
- Pending vs confirmed balance tracking
- Configurable expiry (rolling or fixed date)
- Multi-currency points per program

## API

```typescript
import { PointsService } from "@loyaltyos/core";

const points = new PointsService(prisma);

await points.accumulate(accountId, 100, "earn", { idempotencyKey: "tx-001" });
await points.redeem(accountId, 50, "reward", { idempotencyKey: "tx-002" });
await points.reverse(transactionId, "incorrect amount");
```

See the [full README on GitHub](https://github.com/jvillatox/loyaltyos/blob/main/packages/core/README.md) for details.

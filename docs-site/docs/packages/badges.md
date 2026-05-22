---
sidebar_position: 6
title: Badges
---

# Badges (`@loyaltyos/badges`)

Badges and tiers engine — gamification for your loyalty program.

## Badge Types

- **Achievement** — earned by completing a goal (e.g., "First Purchase")
- **Status** — reflects current standing (e.g., "VIP Member")
- **Temporal** — time-limited (e.g., "Holiday Shopper 2025")
- **Collectible** — part of a series (e.g., "Explorer Set 3/10")
- **Social** — earned through social actions (e.g., "Top Referrer")

## Badge Conditions DSL

Temporal operators: `count_in_window`, `within`, `since`. Progress tracking from 0-100% with event-driven auto-evaluation.

## Tiers

Configurable rank hierarchy with threshold-based upgrades:

- Min points per tier
- Inactivity downgrade job
- Progress-to-next-tier tracking
- Tier benefits (stored as JSON)

```typescript
import { BadgesService } from "@loyaltyos/badges";

const badges = new BadgesService(prisma);
await badges.evaluate(event); // auto-evaluate badges on events
```

See the [full README on GitHub](https://github.com/jvillatox/loyaltyos/blob/main/packages/badges/README.md) for details.

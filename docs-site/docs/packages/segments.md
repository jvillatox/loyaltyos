---
sidebar_position: 4
title: Segments
---

# Segments (`@loyaltyos/segments`)

Dynamic customer segmentation with a visual rule builder.

## Segment Types

- **Dynamic** — rule-based, automatically evaluated
- **Static** — manually curated list of member IDs

## Rule DSL

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `contains`, `in`

```json
{
  "operator": "AND",
  "conditions": [
    { "field": "totalPoints", "operator": "gt", "value": 1000 },
    { "field": "tier", "operator": "eq", "value": "Gold" }
  ]
}
```

Supports recursive AND/OR groups for complex audience definitions. Real-time member count estimation before saving.

See the [full README on GitHub](https://github.com/jvillatox/loyaltyos/blob/main/packages/segments/README.md) for details.

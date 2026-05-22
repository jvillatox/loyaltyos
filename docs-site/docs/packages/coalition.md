---
sidebar_position: 7
title: Coalition
---

# Coalition (`@loyaltyos/coalition`)

Coalition adapter — connect LoyaltyOS to external points systems like Puntos Apprecio.

## Features

- Pluggable adapter interface — swap providers by implementing a single interface
- Two-phase commit for safe cross-system operations
- Circuit breaker per adapter (opens after 5 consecutive failures)
- Retry logic with exponential backoff (max 3 attempts)
- Credential encryption at rest (AES-256-GCM)
- Cached external balance queries (Redis, 60s TTL)
- Comprehensive error classification with HTTP status mappings

## Built-in Adapters

- **Apprecio** — Puntos Apprecio across MX, CL, CO, PE, EC (MD5 auth)
- **Generic** — template for building custom adapters

## Quick Start

```typescript
import { CoalitionService, createApprecioAdapter } from "@loyaltyos/coalition";

const coalition = new CoalitionService(prisma);
const adapter = createApprecioAdapter({
  apiBase: "https://apiv2.dcanje.mx/api",
  publicToken: process.env.APPRECIO_PUBLIC_TOKEN,
  privateToken: process.env.APPRECIO_PRIVATE_TOKEN,
  identifierType: "email",
});

coalition.registerAdapter(adapter);
```

See the [Coalition Integration Guide](/docs/integrations/coalition) and [GitHub README](https://github.com/jvillatox/loyaltyos/blob/main/packages/coalition/README.md) for details.

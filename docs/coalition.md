# Coalition — Architecture & Adapter Guide

## Overview

The coalition system lets LoyaltyOS programs operate **dual points programs**: your own proprietary loyalty points alongside external coalition points (e.g., Puntos Apprecio). A member can earn, redeem, and convert points across both systems with guaranteed consistency via two-phase commit.

### Key Concepts

| Concept                  | Description                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **CoalitionAdapter**     | Pluggable interface connecting to an external points provider (Apprecio, custom, etc.).       |
| **CoalitionService**     | Orchestrator — manages adapters, enforces two-phase commit, retries, and circuit breaking.    |
| **CoalitionConfig**      | Per-program database row: which provider, endpoint, encrypted credentials, and feature flags. |
| **CoalitionAccount**     | Links a LoyaltyOS member to their external account (e.g., email or RUT in Apprecio).          |
| **CoalitionTransaction** | Immutable audit log of every external operation with status tracking.                         |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     REST API Layer                       │
│  POST /coalition/accumulate  redeem  convert  reverse   │
│  GET  /members/:id/coalition/balance  history           │
│  Admin: config  link  transactions  reconciliation       │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                  CoalitionService                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Idempotency   │  │ Two-Phase    │  │ Compensation  │  │
│  │ (txRef-based) │  │ Commit       │  │ (reverse on   │  │
│  │               │  │ PENDING→OK   │  │  core failure)│  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Retry Logic  │  │ Circuit      │  │ Credential    │  │
│  │ (exp backoff │  │ Breaker      │  │ Encryption    │  │
│  │  max 3)      │  │ (opossum)    │  │ (AES-256-GCM) │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  adapters: Map<string, CoalitionAdapter>                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Apprecio  │  │ Generic  │  │ Custom   │              │
│  │Adapter   │  │(template)│  │Adapter   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                    Data Layer                             │
│  CoalitionConfig  CoalitionAccount  CoalitionTransaction │
└─────────────────────────────────────────────────────────┘
```

### Two-Phase Commit Flow

Every coalition operation follows this pattern:

```
1. Validate config & capabilities
2. Check idempotency (txRef) ─── already processed? → return cached result
3. Load or create CoalitionAccount
4. Create CoalitionTransaction (status=PENDING)
5. Call adapter via circuit breaker + retry wrapper
   ├── Success → UPDATE tx CONFIRMED, update account balance
   └── Failure → UPDATE tx FAILED, store error, throw
6. For "convert": after adapter success, call pointsService.earn/redeem
   └── If core fails → compensation via adapter.reverseTransaction()
```

### Error Classification

| Error Type                       | HTTP Status | Retry?   | Example                                      |
| -------------------------------- | ----------- | -------- | -------------------------------------------- |
| `CoalitionConfigNotFoundError`   | 404         | No       | No config for the given program              |
| `CoalitionAccountNotLinkedError` | 404         | No       | Member not linked to external account        |
| `CoalitionBusinessError`         | 422         | No       | Insufficient balance, min conversion not met |
| `CoalitionTransientError`        | 502         | Yes (3x) | Network timeout, 5xx from provider           |
| `CoalitionCircuitOpenError`      | 503         | No       | Circuit breaker open — adapter is down       |
| `CoalitionUnsupportedError`      | 501         | No       | Adapter does not support this operation      |

### Circuit Breaker

One breaker per adapter (keyed by adapter name). Opens after 5 consecutive failures within a 10-second rolling window. Half-open after 30 seconds. Auto-closes after 3 consecutive successes. When open, all calls are rejected immediately with `CoalitionCircuitOpenError`.

### Retry Logic

- Transient errors (network, timeout, 5xx): up to 3 attempts with exponential backoff (1s → 2s → 4s).
- Business errors: never retried.
- Idempotency ensures retries are safe — duplicate `txRef` values return the original result without re-executing.

## Prisma Models

To use the coalition package, add these models to your Prisma schema:

```prisma
model CoalitionConfig {
  id                    String   @id @default(cuid())
  programId             String   @unique
  program               Program  @relation(fields: [programId], references: [id], onDelete: Restrict)
  provider              String   @default("GENERIC")
  endpoint              String
  encryptedCredentials  String
  conversionRate        Float    @default(1.0)
  accumulationEnabled   Boolean  @default(false)
  redemptionEnabled     Boolean  @default(false)
  conversionEnabled     Boolean  @default(false)
  minConversionPoints   Int      @default(500)
  circuitState          Json?    @default("{}")
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model CoalitionAccount {
  id              String   @id @default(cuid())
  memberId        String
  programId       String
  provider        String
  externalId      String
  externalBalance Float    @default(0)
  linkedAt        DateTime @default(now())
  unlinkedAt      DateTime?
  member          Member   @relation(fields: [memberId], references: [id], onDelete: Restrict)
  program         Program  @relation(fields: [programId], references: [id], onDelete: Restrict)
  transactions    CoalitionTransaction[]

  @@unique([memberId, programId, provider])
  @@index([programId])
}

model CoalitionTransaction {
  id              String   @id @default(cuid())
  accountId       String
  account         CoalitionAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)
  type            String   // EARN, REDEEM
  amount          Float
  localTxRef      String   @unique
  externalTxRef   String?
  status          String   @default("PENDING") // PENDING, CONFIRMED, FAILED, REVERSED
  idempotencyKey  String   @unique
  attempts        Int      @default(1)
  lastError       String?
  metadata        Json?    @default("{}")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([accountId])
  @@index([status])
  @@index([createdAt])
}
```

## How to Add a New Adapter

Follow these steps to connect a new coalition provider.

### Step 1: Create the Adapter Class

Create a new file in your project (e.g., `src/coalition/my-provider.adapter.ts`):

```typescript
import type { CoalitionAdapter, AdapterCapabilities, TxResult } from "@loyaltyos/coalition";

interface MyProviderConfig {
  apiBase: string;
  apiKey: string;
  timeoutMs?: number;
}

export class MyProviderAdapter implements CoalitionAdapter {
  readonly name = "my-provider";

  readonly capabilities: AdapterCapabilities = {
    accumulate: true,
    redeem: true, // set false if not supported
    convert: true,
    reverseTransaction: true, // set false if not supported
    historyQuery: false,
  };

  constructor(private config: MyProviderConfig) {}

  async healthcheck(): Promise<{ ok: boolean; latencyMs?: number; details?: unknown }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.apiBase}/ping`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
      });
      return { ok: response.ok, latencyMs: Date.now() - start };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, details: String(error) };
    }
  }

  async getBalance(externalMemberRef: string): Promise<number> {
    const response = await fetch(
      `${this.config.apiBase}/users/${encodeURIComponent(externalMemberRef)}/balance`,
      { headers: { Authorization: `Bearer ${this.config.apiKey}` } },
    );
    if (!response.ok) throw new Error(`Provider error: ${response.status}`);
    const data = (await response.json()) as { balance: number };
    return data.balance;
  }

  async accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult> {
    const response = await fetch(`${this.config.apiBase}/points/earn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        user: externalMemberRef,
        points,
        reference: txRef,
        ...metadata,
      }),
    });
    if (!response.ok) throw new Error(`Provider error: ${response.status}`);
    const data = (await response.json()) as { id: string; balance: number };
    return { externalTxId: data.id, balanceAfter: data.balance };
  }

  async redeem(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult> {
    // Implementation depends on provider API
  }

  async convert(externalMemberRef: string, ownPoints: number, txRef: string): Promise<TxResult> {
    // Most providers: convert = accumulate (they only receive points)
    return this.accumulate(externalMemberRef, ownPoints, txRef);
  }

  async reverseTransaction(txRef: string, reason: string): Promise<void> {
    // If provider supports reversal
  }

  async queryHistory?(externalMemberRef: string, from: Date, to: Date): Promise<unknown[]> {
    // Optional: return transaction history
    return [];
  }
}

export function createMyProviderAdapter(config: MyProviderConfig): MyProviderAdapter {
  return new MyProviderAdapter(config);
}
```

### Step 2: Declare Capabilities Accurately

The `capabilities` flags control what operations are available. Be honest — if your provider doesn't support an operation, set it to `false` and the system will return `501 Not Implemented` instead of failing at runtime.

```typescript
readonly capabilities: AdapterCapabilities = {
  accumulate: true,
  redeem: false,            // Provider does not support debit
  convert: true,            // Maps to accumulate
  reverseTransaction: false, // Provider does not support reversal
  historyQuery: true,
};
```

### Step 3: Register the Adapter

```typescript
import { CoalitionService } from "@loyaltyos/coalition";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const coalition = new CoalitionService(prisma);

const adapter = createMyProviderAdapter({
  apiBase: process.env.MY_PROVIDER_API_BASE!,
  apiKey: process.env.MY_PROVIDER_API_KEY!,
});

coalition.registerAdapter(adapter);
```

### Step 4: Configure the Program

Create a `CoalitionConfig` row in the database (or use the Admin UI):

```typescript
import { encrypt, getMasterKey } from "@loyaltyos/coalition";

const masterKey = getMasterKey();
const credentials = encrypt(
  JSON.stringify({
    apiKey: process.env.MY_PROVIDER_API_KEY!,
    apiBase: "https://api.my-provider.com/v1",
  }),
  masterKey,
);

await coalition.upsertConfig({
  programId: "prog_1",
  provider: "my-provider",
  endpoint: "https://api.my-provider.com/v1",
  encryptedCredentials: credentials,
  conversionRate: 1.0,
  accumulationEnabled: true,
  redemptionEnabled: true,
  conversionEnabled: false,
  minConversionPoints: 500,
});
```

### Step 5: Write Tests

Create a `MockAdapter` for your tests and verify:

- Happy path for each supported operation
- Error handling (business errors vs transient errors)
- Capabilities enforcement (unsupported operations throw `CoalitionUnsupportedError`)
- Idempotency (duplicate txRef returns cached result)
- Credential encryption round-trip

### Adapter Checklist

Use this checklist when implementing a new adapter:

- [ ] `healthcheck()` returns latency and ok/fail
- [ ] `getBalance()` handles unknown users gracefully (return 0, not an error)
- [ ] `accumulate()` is idempotent by txRef
- [ ] `capabilities` flags are accurate
- [ ] Business errors (4xx) are distinguishable from transient errors (5xx/timeout)
- [ ] Secrets never appear in error messages or logs
- [ ] Timeout is configurable
- [ ] Unit tests with mocked HTTP
- [ ] Integration test with real/sandbox credentials
- [ ] README section documenting setup

## Operations Reference

### Accumulate

Dual accumulation: points earned in both the local program and the coalition provider.

```
POST /api/v1/coalition/accumulate
Headers: X-API-Key, X-Program-Id, Idempotency-Key
Body: { memberId, points, txRef, metadata? }
```

### Redeem

Debit points from the external coalition account.

```
POST /api/v1/coalition/redeem
Headers: X-API-Key, X-Program-Id, Idempotency-Key
Body: { memberId, points, txRef }
```

If the active adapter does not support redeem, returns `501 UNSUPPORTED_OPERATION`.

### Convert

Convert local points to coalition points at the configured conversion rate.

```
POST /api/v1/coalition/convert
Headers: X-API-Key, X-Program-Id, Idempotency-Key
Body: { memberId, ownPoints, txRef }
```

For Apprecio, this maps to an accumulate call (Apprecio only receives points).

### Reverse

Manually reverse a coalition transaction.

```
POST /api/v1/coalition/reverse
Headers: X-API-Key, X-Program-Id, Idempotency-Key
Body: { txRef, reason }
```

### Get External Balance

```
GET /api/v1/members/:id/coalition/balance
```

Returns the member's balance from the external coalition provider. Cached in Redis for 60 seconds.

## Credential Encryption

Coalition provider credentials are encrypted at rest using AES-256-GCM.

```typescript
import { encrypt, decrypt, getMasterKey } from "@loyaltyos/coalition";

const masterKey = getMasterKey(); // KMS_MASTER_KEY env var or dev fallback

// Encrypt credentials before storing
const encrypted = encrypt(
  JSON.stringify({
    apiKey: "sk-...",
    apiSecret: "secret-...",
  }),
  masterKey,
);

// Decrypt when the adapter needs them
const decrypted = decrypt(encrypted, masterKey);
const creds = JSON.parse(decrypted);
```

**Production:** Set the `KMS_MASTER_KEY` environment variable to a 32-byte hex string. In development, a hardcoded fallback is used with a console warning.

**Migration path to KMS/Vault:** The `getMasterKey()` function is the single integration point. Replace its implementation to fetch from AWS KMS, HashiCorp Vault, or your key management service of choice.

## Built-in Adapters

### Apprecio

Connects to Puntos Apprecio across Mexico, Chile, Colombia, Peru, and Ecuador. Uses MD5 form-data authentication. See [coalition-apprecio.md](./coalition-apprecio.md) for complete setup.

### Noop / Testing

For development without a real coalition provider, use the `MockAdapter` pattern from the test suite:

```typescript
class NoopAdapter implements CoalitionAdapter {
  name = "noop";
  capabilities = {
    accumulate: true,
    redeem: true,
    convert: true,
    reverseTransaction: true,
    historyQuery: true,
  };
  async healthcheck() {
    return { ok: true };
  }
  async getBalance() {
    return 0;
  }
  async accumulate(_e: string, points: number, txRef: string) {
    return { externalTxId: `noop-${txRef}`, balanceAfter: points };
  }
  async redeem(_e: string, points: number, txRef: string) {
    return { externalTxId: `noop-${txRef}`, balanceAfter: 0 };
  }
  async convert(_e: string, ownPoints: number, txRef: string) {
    return { externalTxId: `noop-${txRef}`, balanceAfter: ownPoints };
  }
  async reverseTransaction() {
    /* no-op */
  }
}
```

## Troubleshooting

| Symptom                               | Likely Cause                                       | Resolution                                                        |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `CoalitionConfigNotFoundError`        | No config row exists for the program               | Run `upsertConfig()` or use the Admin UI Coalition Config page    |
| `CoalitionAccountNotLinkedError`      | Member has no linked external account              | Call `POST /admin/coalition/link` with the external identifier    |
| `CoalitionUnsupportedError`           | Adapter does not implement this operation          | Check `capabilities` flags. Apprecio does not support redeem.     |
| `CoalitionCircuitOpenError`           | Circuit breaker open — provider is failing         | Wait 30s for auto half-open, or check provider health             |
| `CoalitionBusinessError` (422)        | Business rule violation (min points, insufficient) | Check the error message; adjust input or program config           |
| Transaction stuck in `PENDING`        | Adapter call timed out without updating status     | Use Force Reverse in Admin UI, or run reconciliation job          |
| Adapter returns 401/403               | Invalid credentials or IP not whitelisted          | Verify `encryptedCredentials` in CoalitionConfig                  |
| `getBalance` returns 0 for known user | User not registered with the provider              | Ensure the member is enrolled in the external program             |
| Redis connection errors in logs       | Redis unavailable, cache degraded                  | Coalition operations continue without cache; fix Redis connection |

### Debugging Tips

1. **Check adapter health:** `POST /admin/coalition/healthcheck` returns latency and status.
2. **Inspect capabilities:** `GET /admin/coalition/config` shows the active provider and its capabilities.
3. **View transaction timeline:** Admin UI > Coalition > Transactions — click any row for full detail.
4. **Run reconciliation:** `POST /admin/coalition/reconciliation` compares local and external state.
5. **Check circuit state:** The `circuitState` JSON column in `CoalitionConfig` persists breaker state across restarts.

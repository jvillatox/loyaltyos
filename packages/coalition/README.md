# @loyaltyos/coalition

Generic coalition loyalty adapter for LoyaltyOS. Connects your loyalty program to external coalition providers (Apprecio and others) via a pluggable adapter interface with two-phase commit, idempotency, retries, and circuit breaking.

## Features

- **Pluggable adapters** — implement the `CoalitionAdapter` interface with explicit capabilities flags
- **Two-phase commit** — PENDING transaction created first, then confirmed or rolled back
- **Compensation** — if core points operations fail after an external adapter succeeds, the external operation is reversed
- **Idempotency** — duplicate `txRef` values return the original result without calling the adapter
- **Retries with backoff** — transient errors (network, timeout) retry up to 3 times with exponential backoff (1s, 2s, 4s); business errors never retry
- **Circuit breaker** — via `opossum`, opens after 5 failures in a 10s window, half-open after 30s
- **Credential encryption** — AES-256-GCM for storing adapter credentials, with a migration path to AWS KMS / HashiCorp Vault
- **Apprecio adapter** — built-in adapter for the Apprecio coalition API with MD5 auth and multi-country support

## Installation

```bash
pnpm add @loyaltyos/coalition
```

## Usage

### Generic adapter setup

```typescript
import { CoalitionService, encrypt, getMasterKey } from "@loyaltyos/coalition";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const coalition = new CoalitionService(prisma);

// Implement the adapter interface
class MyCoalitionAdapter implements CoalitionAdapter {
  name = "my-coalition";
  capabilities = {
    accumulate: true,
    redeem: true,
    convert: false,
    reverseTransaction: false,
    historyQuery: false,
  };

  async healthcheck() {
    /* ... */
  }
  async getBalance(externalMemberRef: string) {
    /* ... */
  }
  async accumulate(externalMemberRef: string, points: number, txRef: string, metadata?: object) {
    /* ... */
  }
  async redeem(externalMemberRef: string, points: number, txRef: string, metadata?: object) {
    /* ... */
  }
}

coalition.registerAdapter(new MyCoalitionAdapter());
```

### Apprecio adapter (built-in)

```typescript
import { createApprecioAdapter } from "@loyaltyos/coalition";

const adapter = createApprecioAdapter({
  apiBase: "https://apiv2.dcanje.mx/api",
  publicToken: process.env.APPRECIO_PUBLIC_TOKEN!,
  privateToken: process.env.APPRECIO_PRIVATE_TOKEN!,
  identifierType: "email",
  timeoutMs: 10000,
});

coalition.registerAdapter(adapter);
```

### Operations

```typescript
// Dual accumulation (own points + coalition points)
await coalition.accumulate({
  programId: "prog_1",
  memberId: "mem_1",
  externalMemberRef: "user@example.com",
  points: 100,
  txRef: "unique-tx-ref-1",
});

// Redeem coalition points
await coalition.redeem({
  programId: "prog_1",
  memberId: "mem_1",
  externalMemberRef: "user@example.com",
  points: 50,
  txRef: "unique-tx-ref-2",
});

// Convert own points to coalition points
await coalition.convert({
  programId: "prog_1",
  memberId: "mem_1",
  externalMemberRef: "user@example.com",
  ownPoints: 500,
  txRef: "unique-tx-ref-3",
});

// Get external balance
const balance = await coalition.getExternalBalance("mem_1", "prog_1");
```

### Credential encryption

```typescript
import { encrypt, decrypt, getMasterKey } from "@loyaltyos/coalition";

const masterKey = getMasterKey(); // KMS_MASTER_KEY env var or dev fallback
const encrypted = encrypt(JSON.stringify({ apiKey: "sk-..." }), masterKey);
const decrypted = decrypt(encrypted, masterKey);
```

### Config management

```typescript
await coalition.upsertConfig({
  programId: "prog_1",
  provider: "APPRECIO",
  endpoint: "https://apiv2.dcanje.mx/api",
  encryptedCredentials: encrypted,
  conversionRate: 1.0,
  accumulationEnabled: true,
  redemptionEnabled: false,
  conversionEnabled: true,
  minConversionPoints: 500,
});
```

## Adapter Interface

```typescript
interface AdapterCapabilities {
  readonly accumulate: boolean;
  readonly redeem: boolean;
  readonly convert: boolean;
  readonly reverseTransaction: boolean;
  readonly historyQuery: boolean;
}

interface CoalitionAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  healthcheck(): Promise<{ ok: boolean; latencyMs?: number; details?: unknown }>;
  getBalance(externalMemberRef: string): Promise<number>;
  accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult>;
  redeem?(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult>;
  convert?(externalMemberRef: string, ownPoints: number, txRef: string): Promise<TxResult>;
  reverseTransaction?(txRef: string, reason: string): Promise<void>;
  queryHistory?(externalMemberRef: string, from: Date, to: Date): Promise<unknown[]>;
}
```

The `capabilities` flags declare what the adapter supports. `CoalitionService` checks capabilities before invoking optional methods and throws `CoalitionUnsupportedError` if the operation is not supported.

## Error Handling

| Error Class                      | HTTP Status | Description                             |
| -------------------------------- | ----------- | --------------------------------------- |
| `CoalitionConfigNotFoundError`   | 404         | No config for the given program         |
| `CoalitionAccountNotLinkedError` | 404         | Member not linked to external account   |
| `CoalitionBusinessError`         | 422         | Business rule violation (e.g., min pts) |
| `CoalitionTransientError`        | 502         | Temporary external service failure      |
| `CoalitionCircuitOpenError`      | 503         | Circuit breaker is open                 |
| `CoalitionUnsupportedError`      | 501         | Adapter does not support this operation |

Transient errors (network, timeout, 5xx) are automatically retried. Business errors are never retried.

## Database Models

- **CoalitionConfig** — per-program configuration (provider, endpoint, encrypted credentials, feature toggles)
- **CoalitionAccount** — links a LoyaltyOS member to their external coalition account
- **CoalitionTransaction** — audit log for every coalition operation with status tracking

## Environment Variables

| Variable         | Required   | Default      | Description                                      |
| ---------------- | ---------- | ------------ | ------------------------------------------------ |
| `KMS_MASTER_KEY` | production | dev fallback | Master key for AES-256-GCM credential encryption |

For Apprecio adapter configuration, see [docs/coalition-apprecio.md](../../docs/coalition-apprecio.md).

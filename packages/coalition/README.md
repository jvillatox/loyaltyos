# @loyaltyos/coalition

Generic coalition loyalty adapter for LoyaltyOS. Connects your loyalty program to external coalition providers via a pluggable adapter interface with two-phase commit, idempotency, retries, and circuit breaking.

## Features

- **Pluggable adapters** — implement the `CoalitionAdapter` interface and register it
- **Two-phase commit** — PENDING transaction created first, then confirmed or rolled back
- **Compensation** — if core points operations fail after an external adapter succeeds, the external operation is reversed
- **Idempotency** — duplicate `txRef` values return the original result without calling the adapter
- **Retries with backoff** — transient errors (network, timeout) retry up to 3 times with exponential backoff; business errors never retry
- **Circuit breaker** — via `opossum`, opens after 5 failures in a 10s window, half-open after 30s
- **Credential encryption** — AES-256-GCM for storing adapter credentials, with a migration path to AWS KMS / HashiCorp Vault

## Usage

```typescript
import { CoalitionService, encrypt, getMasterKey } from "@loyaltyos/coalition";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const coalition = new CoalitionService(prisma);

// Implement the adapter for your coalition provider
class MyCoalitionAdapter implements CoalitionAdapter {
  name = "my-coalition";
  // ... implement healthcheck, getBalance, accumulate, redeem, convert, reverseTransaction
}

// Register it
coalition.registerAdapter(new MyCoalitionAdapter());

// Store encrypted credentials in CoalitionConfig
const masterKey = getMasterKey(); // set KMS_MASTER_KEY env var in production
const creds = encrypt(JSON.stringify({ apiKey: "sk-...", merchantId: "m-1" }), masterKey);

// Run operations
const result = await coalition.accumulate({
  programId: "prog_1",
  memberId: "mem_1",
  externalMemberRef: "ext-ref-123",
  points: 100,
  txRef: "unique-tx-ref",
});
```

## Adapter Interface

```typescript
interface CoalitionAdapter {
  name: string;
  healthcheck(): Promise<{ ok: boolean; latencyMs?: number; details?: unknown }>;
  getBalance(externalMemberRef: string): Promise<number>;
  accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult>;
  redeem(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult>;
  convert(externalMemberRef: string, ownPoints: number, txRef: string): Promise<TxResult>;
  reverseTransaction(txRef: string, reason: string): Promise<void>;
}
```

## Database Models

- **CoalitionConfig** — per-program configuration (provider, endpoint, encrypted credentials, feature toggles)
- **CoalitionAccount** — links a LoyaltyOS member to their external coalition account
- **CoalitionTransaction** — audit log for every coalition operation with status tracking

## Environment Variables

| Variable         | Required   | Default      | Description                                      |
| ---------------- | ---------- | ------------ | ------------------------------------------------ |
| `KMS_MASTER_KEY` | production | dev fallback | Master key for AES-256-GCM credential encryption |

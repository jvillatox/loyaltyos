---
sidebar_position: 1
title: Coalition Integration
---

# Coalition Integration

The coalition system lets LoyaltyOS programs operate **dual points programs**: your own proprietary loyalty points alongside external coalition points (e.g., Puntos Apprecio).

## Key Concepts

| Concept                  | Description                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **CoalitionAdapter**     | Pluggable interface connecting to an external points provider                                |
| **CoalitionService**     | Orchestrator — manages adapters, enforces two-phase commit, retries, and circuit breaking    |
| **CoalitionConfig**      | Per-program database row: which provider, endpoint, encrypted credentials, and feature flags |
| **CoalitionAccount**     | Links a LoyaltyOS member to their external account (e.g., email or RUT in Apprecio)          |
| **CoalitionTransaction** | Immutable audit log of every external operation with status tracking                         |

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
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Idempotency   │  │ Two-Phase    │  │ Compensation  │  │
│  │ (txRef-based) │  │ Commit       │  │ (reverse on   │  │
│  │               │  │ PENDING→OK   │  │  core failure)│  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Retry Logic  │  │ Circuit      │  │ Credential    │  │
│  │ (exp backoff │  │ Breaker      │  │ Encryption    │  │
│  │  max 3)      │  │ (opossum)    │  │ (AES-256-GCM) │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│  adapters: Map<string, CoalitionAdapter>                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Apprecio  │  │ Generic  │  │ Custom   │              │
│  │Adapter   │  │(template)│  │Adapter   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

## Two-Phase Commit Flow

```
1. Validate config & capabilities
2. Check idempotency (txRef) → already processed? → return cached result
3. Load or create CoalitionAccount
4. Create CoalitionTransaction (status=PENDING)
5. Call adapter via circuit breaker + retry wrapper
   ├── Success → UPDATE tx CONFIRMED, update account balance
   └── Failure → UPDATE tx FAILED, store error, throw
6. For "convert": after adapter success, call pointsService.earn/redeem
   └── If core fails → compensation via adapter.reverseTransaction()
```

## Error Classification

| Error Type                       | HTTP Status | Retry?   | Example                                      |
| -------------------------------- | ----------- | -------- | -------------------------------------------- |
| `CoalitionConfigNotFoundError`   | 404         | No       | No config for the given program              |
| `CoalitionAccountNotLinkedError` | 404         | No       | Member not linked to external account        |
| `CoalitionBusinessError`         | 422         | No       | Insufficient balance, min conversion not met |
| `CoalitionTransientError`        | 502         | Yes (3x) | Network timeout, 5xx from provider           |
| `CoalitionCircuitOpenError`      | 503         | No       | Circuit breaker open — adapter is down       |
| `CoalitionUnsupportedError`      | 501         | No       | Adapter does not support this operation      |

## Built-in Adapters

### Apprecio

Connects to Puntos Apprecio across Mexico, Chile, Colombia, Peru, and Ecuador. Uses MD5 form-data authentication.

| Country  | API Base URL                        |
| -------- | ----------------------------------- |
| Mexico   | `https://apiv2.dcanje.mx/api`       |
| Chile    | `https://api.apprecio.cl/api`       |
| Colombia | `https://apiv2.apprecio.com.co/api` |
| Peru     | `https://apiv2.apprecio.pe/api`     |
| Ecuador  | `https://apiv2.ec.dcanje.com/api`   |

### How to Add a New Adapter

Implement the `CoalitionAdapter` interface:

```typescript
interface CoalitionAdapter {
  readonly name: string;
  readonly capabilities: AdapterCapabilities;
  healthcheck(): Promise<{ ok: boolean; latencyMs?: number }>;
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
  queryHistory?(externalMemberRef: string, from: Date, to: Date): Promise<unknown[]>;
}
```

Then register it:

```typescript
const coalition = new CoalitionService(prisma);
coalition.registerAdapter(new MyProviderAdapter(config));
```

## Credential Encryption

Coalition provider credentials are encrypted at rest using AES-256-GCM:

```typescript
import { encrypt, decrypt, getMasterKey } from "@loyaltyos/coalition";

const masterKey = getMasterKey(); // KMS_MASTER_KEY env var
const encrypted = encrypt(JSON.stringify({ apiKey: "sk-...", apiSecret: "..." }), masterKey);
const decrypted = decrypt(encrypted, masterKey);
```

Set `KMS_MASTER_KEY` to a 32-byte hex string in production.

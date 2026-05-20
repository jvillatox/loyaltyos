# Coalition — Apprecio Adapter

## Overview

Apprecio is a loyalty points platform operating across five Latin American countries: Mexico (MX), Chile (CL), Colombia (CO), Peru (PE), and Ecuador (EC). The LoyaltyOS Apprecio adapter integrates with Apprecio's REST API to manage coalition points — accumulating points on behalf of users, querying balances, and retrieving transaction history.

Supported countries and their API base URLs:

| Country  | Code | API Base URL                        |
| -------- | ---- | ----------------------------------- |
| Mexico   | MX   | `https://apiv2.dcanje.mx/api`       |
| Chile    | CL   | `https://api.apprecio.cl/api`       |
| Colombia | CO   | `https://apiv2.apprecio.com.co/api` |
| Peru     | PE   | `https://apiv2.apprecio.pe/api`     |
| Ecuador  | EC   | `https://apiv2.ec.dcanje.com/api`   |

## Authentication

Apprecio uses an MD5-based signature scheme. Every request must include the following POST form fields:

| Parameter      | Description                                 |
| -------------- | ------------------------------------------- |
| `accion`       | Endpoint name (e.g., `carga_directa_email`) |
| `public_token` | Public token identifying the merchant       |
| `ts`           | Timestamp or unique transaction code        |
| `hash`         | `MD5(ts + public_token + private_token)`    |
| `tipo`         | Response format — always `JSON`             |

### Hash calculation example

```
ts = "1234567890"
public_token = "pub-token-abc"
private_token = "priv-secret-xyz"

hash = MD5("1234567890" + "pub-token-abc" + "priv-secret-xyz")
     = MD5("1234567890pub-token-abcpriv-secret-xyz")
     = "a1b2c3d4e5f6..."
```

The adapter passes the transaction reference (`txRef`) as the `ts` parameter, providing natural idempotency — Apprecio treats repeated `ts` values as duplicate transactions.

**Security note:** The `public_token` is sent in the request body. The `private_token` is used only for hash generation and is never sent over the wire or included in logs or error messages.

## Action Mapping

| CoalitionAdapter Method | Apprecio `accion` (email) | Apprecio `accion` (RUT) | Notes                                       |
| ----------------------- | ------------------------- | ----------------------- | ------------------------------------------- |
| `accumulate`            | `carga_directa_email`     | `acumular_puntos`       | Adds points to user                         |
| `getBalance`            | `saldo_usuario_email`     | `saldo_usuario`         | Returns current balance                     |
| `queryHistory`          | `historialCarga`          | `historialCarga`        | Date-range history, not user-scoped         |
| `convert`               | `carga_directa_email`     | `acumular_puntos`       | Maps to accumulate (Apprecio only receives) |
| `redeem`                | —                         | —                       | Not supported by Apprecio API               |
| `reverseTransaction`    | —                         | —                       | Not supported by Apprecio API               |

## Supported Flows

| Flow                           | Supported | Notes                                                                                          |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------- |
| Double accumulation            | Yes       | `accion=carga_directa_email` or `acumular_puntos`. Both programs earn.                         |
| Cross-system redemption        | No        | Apprecio API does not expose a redeem/debit endpoint.                                          |
| Convert own points to Apprecio | Yes       | Maps to `accumulate`. CoalitionService debits local points, then calls accumulate on Apprecio. |

## Configuration

### Environment Variables

```bash
# Coalition — Apprecio (real API)
APPRECIO_API_BASE=https://apiv2.dcanje.mx/api
APPRECIO_PUBLIC_TOKEN=<your-public-token>
APPRECIO_PRIVATE_TOKEN=<your-private-token>
APPRECIO_IDENTIFIER_TYPE=email
APPRECIO_TIMEOUT_MS=10000
```

### CoalitionConfig Database Row

When creating a coalition config for Apprecio, the `encryptedCredentials` JSON field (encrypted at rest with AES-256-GCM) contains:

```json
{
  "apiBase": "https://apiv2.dcanje.mx/api",
  "publicToken": "<public-token>",
  "privateToken": "<private-token>",
  "identifierType": "email",
  "timeoutMs": 10000
}
```

The `provider` field should be set to `"APPRECIO"`.

### Adapter Registration

```typescript
import { createApprecioAdapter } from "@loyaltyos/coalition";
import { APPRECIO_BASE_URLS } from "@loyaltyos/coalition";

const adapter = createApprecioAdapter({
  apiBase: APPRECIO_BASE_URLS.MX,
  publicToken: process.env.APPRECIO_PUBLIC_TOKEN,
  privateToken: process.env.APPRECIO_PRIVATE_TOKEN,
  identifierType: "email",
});

coalitionService.registerAdapter(adapter);
```

## Limitations

- **No redeem / debit.** Apprecio API only supports adding points. Cross-system redemption (User earns in Program A, Program B debits from Apprecio) is not possible through the API.
- **No reverseTransaction.** There is no endpoint to cancel or reverse a previously submitted transaction.
- **Single identifier type.** Each adapter instance uses either email OR RUT identification, not both. If you need to support both identifier types, create two adapter instances with different `identifierType` values.
- **History is not user-scoped.** The `historialCarga` endpoint returns all transactions for the merchant within a date range, not filtered by user. The adapter passes the returned data through; client code is responsible for filtering by user if needed.
- **No sandbox environment.** Apprecio does not provide a public sandbox. All testing must be done with production credentials.

## Sandbox Checklist

When Apprecio provides your production credentials, validate connectivity:

1. Set `APPRECIO_API_BASE` for your target country.
2. Set `APPRECIO_PUBLIC_TOKEN` and `APPRECIO_PRIVATE_TOKEN`.
3. Start the API server and call `coalitionService.getActiveAdapter(programId)` to verify adapter initialization.
4. Call `adapter.healthcheck()` — should return `{ ok: true, latencyMs: <number> }`.
5. Call `adapter.getBalance("test@example.com")` — should return `0` for an unknown user (not an error).
6. Call `adapter.accumulate("test@example.com", 1, "test-tx-001")` with a small point amount to verify end-to-end.
7. Check Apprecio's merchant dashboard to confirm the transaction appears.
8. Call `adapter.getBalance("test@example.com")` again to verify the balance reflects the test transaction.

## Troubleshooting

| Symptom                                                     | Likely Cause                                                               | Resolution                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Apprecio auth failed (HTTP 401)`                           | Wrong `public_token` or `private_token`                                    | Verify credentials in `encryptedCredentials` JSON. Regenerate tokens from Apprecio dashboard if needed.                           |
| `Apprecio auth failed (HTTP 403)`                           | IP not whitelisted or account inactive                                     | Check if Apprecio requires IP whitelisting for API access. Verify account is active.                                              |
| `Apprecio client error (HTTP 400)`                          | Missing required field (e.g., `email` or `asignado`)                       | Validate input before calling the adapter. The adapter validates `identifierType`, but the API may reject other malformed fields. |
| `Apprecio business error: User not found`                   | User does not exist in Apprecio's program                                  | User must be registered in Apprecio before points can be accumulated. Check the member's enrollment status.                       |
| `Apprecio config error: ... does not appear to be an email` | `identifierType` is `email` but the provided `externalMemberRef` lacks `@` | Use a valid email address or switch `identifierType` to `rut`.                                                                    |
| Timestamp/sync issues                                       | `ts` parameter is used as both timestamp and idempotency key               | The adapter uses `txRef` as `ts`. Ensure `txRef` values are unique per transaction (they already are in CoalitionService).        |

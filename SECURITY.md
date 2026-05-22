# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Do not open a public issue.** Please report security vulnerabilities privately to:

**Email:** `security@loyaltyos.dev`

You should receive an initial response within 48 hours. The disclosure timeline:

1. **Report** — You send a detailed report with steps to reproduce.
2. **Acknowledgment** — We confirm receipt within 48 hours and assign a tracking ID.
3. **Assessment** — We evaluate severity and scope (typically 5 business days).
4. **Fix Development** — We develop and test a fix. You may be asked to validate.
5. **Release** — We release the fix and publish an advisory via GitHub Security Advisories.
6. **Disclosure** — Credit is given to the reporter (unless anonymity is requested).

## Scope

Security reports are welcome for:

- The LoyaltyOS REST API (`apps/api/`)
- Core business logic packages (`packages/core/`, `packages/coalition/`, `packages/campaigns/`, etc.)
- Authentication and authorization flows
- Points ledger integrity
- Coalition credential handling
- Notification template rendering (XSS)
- Webhook signature verification

### Out of Scope

- Missing security headers not covered by `@fastify/helmet` defaults
- Theoretical attacks requiring physical access or admin credentials
- Social engineering or phishing
- Denial of service via resource exhaustion (rate limiting is in place)

## Security Design

LoyaltyOS follows these principles:

- **Zod validation** on every API boundary — no unvalidated input reaches business logic.
- **Immutable ledger** — point transactions are never deleted; reversals use contra-entries.
- **Idempotency keys** — critical operations (accumulate, redeem, convert) are safe to retry.
- **Credential encryption** — coalition provider credentials are AES-256-GCM encrypted at rest.
- **Magic-link auth** — passwordless; no passwords are stored or transmitted.
- **API key scoping** — SERVER vs CLIENT keys with program-level isolation.
- **Helmet defaults** — CSP, HSTS, X-Frame-Options, Referrer-Policy.
- **Rate limiting** — per-endpoint limits on auth, redeem, accumulate.
- **Webhook signing** — HMAC-SHA256 with time-bounded tolerance (5 min).
- **Handlebars sandbox** — auto-escaping enabled, prototype chain stripped, dangerous globals blocked.

## Responsible Disclosure Hall of Fame

We appreciate and credit security researchers who follow this policy. Names are added here with permission.

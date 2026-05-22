# Security Notes — Dependency Audit

Last reviewed: 2026-05-21 for v1.0.0 pre-release.

## Fastify 4.x Vulnerabilities

Fastify 4.29.1 is the latest 4.x release. Two vulnerabilities are patched only in Fastify 5.x:

| CVE / GHSA          | Severity | Issue                                             | Compensating Control                                                                                                   |
| ------------------- | -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GHSA-jx2c-rxcm-jvmq | High     | Content-Type tab character body validation bypass | All endpoints validate body with Zod. Even if Content-Type parsing is bypassed, Zod schemas reject malformed payloads. |
| GHSA-mrq3-vjjr-p77c | Low      | DoS via unbounded memory in sendWebStream         | Application does not use `sendWebStream` API.                                                                          |

### Migration path

Fastify 5 introduced breaking changes (removed `setNotFoundHandler` signature, changed plugin registration order). Upgrade planned for v1.1.0.

## Docusaurus Transitive Dependencies

The following vulnerabilities are in Docusaurus build-time dependencies only — they affect the static site generator, not runtime serving:

| Package              | Issue                       | Impact                                                            |
| -------------------- | --------------------------- | ----------------------------------------------------------------- |
| serialize-javascript | RCE via RegExp.flags        | Build-time only. No user-controlled input reaches the serializer. |
| uuid                 | Missing buffer bounds check | Build-time only. Used in sockjs/webpack-dev-server.               |

These are tracked upstream (Docusaurus 3.x + Webpack). No action required for production deployments.

## @fastify/helmet Version Constraint

`@fastify/helmet` v12+ requires Fastify 5.x. Since we're on Fastify 4.29.1, we pin `@fastify/helmet@11.1.1` (last Fastify 4-compatible release). When upgrading to Fastify 5 in v1.1.0, update to `@fastify/helmet@13.x`.

## Mitigations Applied

- **pnpm overrides** for `fast-uri` to ensure >=3.1.1
- **@fastify/helmet@11.1.1** for standard security headers (CSP, HSTS, X-Frame-Options, etc.)
- **Per-endpoint rate limiting** on auth, redeem, accumulate
- **CORS whitelist** per program via database config
- **Webhook timestamp validation** (5-min window)
- **Handlebars sandbox** with `noEscape: false`, prototype stripping, blocked globals
- **Zod validation** on all API boundaries

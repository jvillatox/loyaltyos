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

## Audit log 2026-05-22

Full `pnpm audit --prod` output for v1.0.0 re-release (commit `baa8d9c`):

```
9 vulnerabilities found
Severity: 1 low | 4 moderate | 4 high

High:
- fastify (GHSA-jx2c-rxcm-jvmq) — Content-Type tab character body validation bypass. Patched in >=5.7.2. Mitigation: Zod validation on all boundaries.
- serialize-javascript (GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v) — RCE via RegExp.flags. Patched in >=7.0.3. Build-time only (Docusaurus/Webpack), no user input.
- @opentelemetry/auto-instrumentations-node (GHSA-...) — Prometheus exporter crash via malformed HTTP. Patched in >=0.75.0. OTEL is opt-in (OTEL_ENABLED=false by default).

Moderate/Low:
- fastify (GHSA-mrq3-vjjr-p77c) — DoS via sendWebStream. Patched in >=5.7.3. Our app does not use sendWebStream API.
- uuid (GHSA-w5hq-g745-h8pq) — Missing buffer bounds check. Patched in >=11.1.1. Build-time only (Docusaurus/sockjs).
- Several Docusaurus transitive deps — All build-time only.
```

All high-severity issues have compensating controls documented above. The remaining
issues are either build-time only (Docusaurus static site) or affect APIs the
application does not use. Fastify 5 upgrade planned for v1.1.0 will resolve the
runtime fastify advisories.

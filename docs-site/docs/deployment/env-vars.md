---
sidebar_position: 2
title: Environment Variables
---

# Environment Variables

Complete reference of environment variables used by LoyaltyOS services.

## API Server

### Required

| Variable         | Description                               | Example                                    |
| ---------------- | ----------------------------------------- | ------------------------------------------ |
| `DATABASE_URL`   | PostgreSQL connection string              | `postgresql://user:pass@localhost:5432/db` |
| `REDIS_URL`      | Redis connection string                   | `redis://localhost:6379`                   |
| `JWT_SECRET`     | Secret for JWT token signing              | `openssl rand -hex 64`                     |
| `API_KEY_SALT`   | Salt for API key hashing                  | `openssl rand -hex 32`                     |
| `KMS_MASTER_KEY` | 32-byte hex key for credential encryption | `openssl rand -hex 32`                     |

### Optional

| Variable         | Description             | Default       |
| ---------------- | ----------------------- | ------------- |
| `PORT`           | API server port         | `3002`        |
| `NODE_ENV`       | Environment             | `development` |
| `LOG_LEVEL`      | Pino logger level       | `info`        |
| `CORS_ORIGIN`    | Allowed CORS origin     | `*`           |
| `RATE_LIMIT_MAX` | Max requests per window | `100`         |

## Email (Resend)

| Variable         | Description      | Required |
| ---------------- | ---------------- | -------- |
| `RESEND_API_KEY` | Resend API key   | Prod     |
| `SMTP_HOST`      | SMTP server host | Dev      |
| `SMTP_PORT`      | SMTP server port | Dev      |
| `SMTP_FROM`      | From address     | Dev      |

## SMS (Twilio)

| Variable              | Description                          |
| --------------------- | ------------------------------------ |
| `TWILIO_ACCOUNT_SID`  | Twilio account SID                   |
| `TWILIO_AUTH_TOKEN`   | Twilio auth token                    |
| `TWILIO_PHONE_NUMBER` | Sender phone number                  |
| `TWILIO_API_BASE`     | API base URL (optional, for testing) |

## Push (OneSignal)

| Variable             | Description         |
| -------------------- | ------------------- |
| `ONESIGNAL_APP_ID`   | OneSignal app       |
| `ONESIGNAL_API_KEY`  | OneSignal key       |
| `ONESIGNAL_API_BASE` | Base URL (optional) |

## Coalition — Apprecio

| Variable                   | Description             |
| -------------------------- | ----------------------- |
| `APPRECIO_API_BASE`        | Apprecio API base URL   |
| `APPRECIO_PUBLIC_TOKEN`    | Public token (merchant) |
| `APPRECIO_PRIVATE_TOKEN`   | Private token (signing) |
| `APPRECIO_IDENTIFIER_TYPE` | `email` or `rut`        |
| `APPRECIO_TIMEOUT_MS`      | Request timeout (ms)    |

## Observability

| Variable                      | Description                      | Default |
| ----------------------------- | -------------------------------- | ------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint          | —       |
| `OTEL_SERVICE_NAME`           | Service name in traces           | —       |
| `WORKER_METRICS_PORT`         | Port for worker metrics endpoint | `3003`  |

## Docker Compose

See `infra/docker/.env.production.example` for the full production template.

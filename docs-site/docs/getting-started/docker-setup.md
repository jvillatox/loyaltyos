---
sidebar_position: 4
title: Docker Setup
---

# Production Docker Setup

## Quick Start

```bash
# 1. Copy and configure environment variables
cp infra/docker/.env.production.example infra/docker/.env.production
# Edit .env.production with your actual secrets and configuration

# 2. Start the production stack
docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.production up -d

# 3. Verify services are running
docker compose -f infra/docker/docker-compose.prod.yml ps
curl -f http://localhost:3002/healthz
```

## Services

| Service  | Port (default) | Description                           |
| -------- | -------------- | ------------------------------------- |
| postgres | 5432           | PostgreSQL 15 Alpine                  |
| redis    | 6379           | Redis 7 Alpine                        |
| api      | 3002           | LoyaltyOS REST API (Fastify + Prisma) |
| admin    | 5173           | Admin Dashboard (React SPA via nginx) |
| portal   | 5174           | Customer Portal (React PWA via nginx) |

## Monitoring (optional profile)

```bash
docker compose -f infra/docker/docker-compose.prod.yml --profile monitoring up -d
```

Adds Prometheus and OpenTelemetry Collector services.

## Volumes

- `pgdata` — PostgreSQL data directory
- `redisdata` — Redis persistence

## Environment Variables

All configuration is driven by the `.env.production` file.

### Required Variables

| Variable            | Description                               |
| ------------------- | ----------------------------------------- |
| `POSTGRES_PASSWORD` | Database password                         |
| `JWT_SECRET`        | Secret for JWT token signing              |
| `API_KEY_SALT`      | Salt for API key hashing                  |
| `KMS_MASTER_KEY`    | 32-byte hex key for credential encryption |

### Generating Secrets

```bash
openssl rand -hex 64   # JWT secret
openssl rand -hex 32   # API key salt
openssl rand -hex 32   # KMS master key
```

## Building Images Locally

```bash
docker build -t loyaltyos-api:dev -f apps/api/Dockerfile .
docker build -t loyaltyos-admin:dev -f apps/admin/Dockerfile .
docker build -t loyaltyos-portal:dev -f apps/portal/Dockerfile .
```

## Architecture Notes

### Compression

Admin and Portal nginx images include the brotli module. Both brotli and gzip are enabled — brotli is preferred by modern browsers.

### Non-Root Users

All container images run as non-root users:

- **API:** `loyaltyos` user
- **Admin / Portal:** `app` user

### Healthchecks

All services include Docker healthchecks:

- **API:** `curl /healthz`
- **Admin / Portal:** `curl /` (nginx serving the SPA)

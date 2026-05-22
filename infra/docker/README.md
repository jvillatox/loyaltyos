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

### Monitoring (--profile monitoring)

| Service        | Port | Description                        |
| -------------- | ---- | ---------------------------------- |
| grafana        | 3000 | Dashboards (admin / admin)         |
| prometheus     | 9090 | Metrics scraper and time-series DB |
| otel-collector | 4317 | OTLP gRPC and HTTP trace ingestion |

## Volumes

- `pgdata` — PostgreSQL data directory
- `redisdata` — Redis persistence

## Environment Variables

All configuration is driven by the `.env.production` file. See `.env.production.example` for the complete template with documentation.

### Required Variables

| Variable            | Description                               |
| ------------------- | ----------------------------------------- |
| `POSTGRES_PASSWORD` | Database password                         |
| `JWT_SECRET`        | Secret for JWT token signing              |
| `API_KEY_SALT`      | Salt for API key hashing                  |
| `KMS_MASTER_KEY`    | 32-byte hex key for credential encryption |

### Generating Secrets

```bash
# Generate a secure JWT secret
openssl rand -hex 64

# Generate an API key salt
openssl rand -hex 32

# Generate a KMS master key
openssl rand -hex 32
```

## Building Images Locally

```bash
# Build all images
docker build -t loyaltyos-api:dev -f apps/api/Dockerfile .
docker build -t loyaltyos-admin:dev -f apps/admin/Dockerfile .
docker build -t loyaltyos-portal:dev -f apps/portal/Dockerfile .
```

## Architecture Notes

### Brotli Compression

Admin and Portal nginx images (`fholzer/nginx-brotli`) include the brotli module compiled in. Both brotli and gzip are enabled — brotli is preferred by modern browsers that send `Accept-Encoding: br`, with gzip as fallback for older clients.

### Non-Root Users

All container images run as non-root users:

- **API:** `loyaltyos` user with group `loyaltyos`
- **Admin / Portal:** `app` user with group `app`

### Healthchecks

All services include Docker healthchecks:

- **API:** `curl /healthz` — checks the Fastify health endpoint
- **Admin / Portal:** `curl /` — checks nginx is serving the SPA

## How to Enable Monitoring Locally

Start the full stack including Prometheus, Grafana, and the OTel Collector with the `monitoring` Compose profile:

```bash
docker compose -f infra/docker/docker-compose.prod.yml --profile monitoring up -d
```

Then open:

- **Grafana:** http://localhost:3000 (credentials: `admin` / `admin`)
- **Prometheus:** http://localhost:9090
- **API Metrics:** http://localhost:3002/metrics

Three Grafana dashboards are auto-provisioned:

1. **API Overview** — HTTP request rates, latency percentiles, error rate, BullMQ queue depth
2. **BullMQ Queues** — Per-queue job throughput and failure rate
3. **Business Metrics** — Points earned/redeemed/adjusted/reversed/expired, coupon redemptions, coalition operations, circuit breaker state, active members

For details on the observability stack, see `docs/observability.md`.

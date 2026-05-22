# Observability

LoyaltyOS ships with Prometheus metrics, Grafana dashboards, and optional OpenTelemetry tracing. All metrics are served by the API at `GET /metrics` in Prometheus text format.

## Stack

| Component      | Purpose                          |
| -------------- | -------------------------------- |
| prom-client    | Node.js metrics instrumentation  |
| Prometheus     | Scrape, store, and query metrics |
| Grafana        | Dashboards and alerting          |
| OTel Collector | Trace export (optional)          |

## Metrics Pipeline

```
Application Code → prom-client (Registry) → GET /metrics → Prometheus (scrape every 15 s)
                                                                   ↓
                                                            Grafana (query + dashboards)
```

The metrics are wired through the `@loyaltyos/telemetry` package. Services in `packages/*` expose lightweight metric interfaces (no dependency on prom-client) and the API layer creates adapters that bridge them to real Prometheus counters, gauges, and histograms.

## Business KPIs

Business metrics track loyalty program activity and are labeled by `program_id`.

| Metric                                      | Type      | Labels                                                  |
| ------------------------------------------- | --------- | ------------------------------------------------------- |
| `loyaltyos_points_earned_total`             | Counter   | `program_id`, `idempotent`                              |
| `loyaltyos_points_redeemed_total`           | Counter   | `program_id`                                            |
| `loyaltyos_points_reversed_total`           | Counter   | `program_id`, `original_type`                           |
| `loyaltyos_points_adjusted_total`           | Counter   | `program_id`                                            |
| `loyaltyos_points_expired_total`            | Counter   | `program_id`                                            |
| `loyaltyos_points_balance`                  | Gauge     | `program_id`                                            |
| `loyaltyos_insufficient_balance_total`      | Counter   | `program_id`                                            |
| `loyaltyos_coupons_redeemed_total`          | Counter   | `program_id`                                            |
| `loyaltyos_coupons_created_total`           | Counter   | `program_id`                                            |
| `loyaltyos_coupons_discount_amount`         | Histogram | `program_id` (buckets: 1, 5, 10, 25, 50, 100, 250, 500) |
| `loyaltyos_coalition_operations_total`      | Counter   | `provider`, `operation`, `status`                       |
| `loyaltyos_coalition_circuit_breaker_state` | Gauge     | `adapter` (0=closed, 1=half-open, 2=open)               |
| `loyaltyos_active_members_total`            | Gauge     | `program_id`                                            |

The `loyaltyos_points_earned_total` counter distinguishes new earns (`idempotent="false"`) from idempotency-key duplicates (`idempotent="true"`) so alerting on real traffic is easy:

```promql
# Rate of genuine point earnings (excluding replays)
sum(rate(loyaltyos_points_earned_total{idempotent="false"}[5m])) by (program_id)
```

## HTTP Metrics

Standard RED metrics (Rate, Errors, Duration) served by the Fastify metrics plugin.

| Metric                          | Type      | Labels                           |
| ------------------------------- | --------- | -------------------------------- |
| `http_requests_total`           | Counter   | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` |
| `http_errors_total`             | Counter   | `method`, `route` (5xx only)     |

## BullMQ Metrics

Worker and queue metrics for jobs processed through Redis-backed queues.

| Metric                        | Type      | Labels            |
| ----------------------------- | --------- | ----------------- |
| `bullmq_queue_depth`          | Gauge     | `queue`           |
| `bullmq_job_duration_seconds` | Histogram | `queue`           |
| `bullmq_jobs_total`           | Counter   | `queue`, `status` |

## Node.js Default Metrics

The prom-client `collectDefaultMetrics` hook exposes standard Node.js process metrics under the `nodejs_` prefix: heap memory, event loop lag, GC duration, open file handles, CPU time, etc.

## Grafana Dashboards

Three dashboards are provisioned automatically when Grafana starts:

1. **LoyaltyOS — API Overview** (`api-overview.json`) — HTTP request rates, latency percentiles (p50/p95/p99), error rate, and BullMQ queue depth.
2. **LoyaltyOS — BullMQ Queues** (`bullmq-queues.json`) — Per-queue job throughput, duration, and failure rate.
3. **LoyaltyOS — Business Metrics** (`business-metrics.json`) — Points earned/redeemed/adjusted/reversed/expired, coupon redemptions, discount amount percentiles, coalition operations by status, circuit breaker state, and active members per program.

## Running the Monitoring Stack

From `infra/docker/`:

```bash
# Start production services + monitoring (Prometheus, Grafana, OTel Collector)
docker compose --profile monitoring up -d
```

- **API metrics**: `http://localhost:3002/metrics`
- **Prometheus**: `http://localhost:9090`
- **Grafana**: `http://localhost:3000` (default credentials: `admin` / `admin`)
- **OTel Collector**: OTLP gRPC on `localhost:4317`, OTLP HTTP on `localhost:4318`

## OpenTelemetry Tracing

The `@loyaltyos/telemetry` package exports `initTracing()` which configures the OpenTelemetry SDK to export traces to the OTel Collector via OTLP gRPC. Tracing is **opt-in** — set `OTEL_ENABLED=true` and configure the exporter endpoint.

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
```

When enabled, all Fastify requests and Prisma queries are automatically traced.

## Environment Variables

| Variable                      | Default | Description                |
| ----------------------------- | ------- | -------------------------- |
| `GRAFANA_ADMIN_USER`          | `admin` | Grafana admin username     |
| `GRAFANA_ADMIN_PASSWORD`      | `admin` | Grafana admin password     |
| `OTEL_ENABLED`                | `false` | Enable OTel tracing export |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —       | OTLP collector endpoint    |

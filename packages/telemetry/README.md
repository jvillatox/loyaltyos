# @loyaltyos/telemetry

Observability package for LoyaltyOS — OpenTelemetry tracing + Prometheus metrics. Zero overhead when disabled (all OTEL imports are dynamic).

## Features

- **Prometheus metrics** — HTTP request counters, duration histograms, error counters, BullMQ queue metrics, Node.js default metrics
- **OpenTelemetry tracing** — auto-instruments HTTP, PostgreSQL, and Redis; exports via OTLP HTTP
- **Fastify plugin** — drop-in `/metrics` endpoint with onResponse hook for automatic HTTP metric collection
- **Zero overhead** — nothing is loaded unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set

## Installation

```bash
pnpm add @loyaltyos/telemetry
```

## Usage

### Metrics

```typescript
import {
  createMetricsRegistry,
  createHttpMetrics,
  createBullMQMetrics,
  setupDefaultMetrics,
  getMetricsContentType,
  getMetricsPayload,
} from "@loyaltyos/telemetry";

const registry = createMetricsRegistry();
setupDefaultMetrics(registry, "my-service");

const http = createHttpMetrics(registry);
const bullmq = createBullMQMetrics(registry);

// Record a job
bullmq.bullmqJobCounter.inc({ queue: "notifications", status: "completed" });
bullmq.bullmqJobDuration.observe({ queue: "notifications" }, 1.5);

// Serve metrics endpoint
const contentType = getMetricsContentType();
const payload = await getMetricsPayload(registry);
```

### Fastify Plugin

```typescript
import { createFastifyMetricsPlugin } from "@loyaltyos/telemetry";

await app.register(createFastifyMetricsPlugin, {
  registry,
  httpMetrics: http,
});
// GET /metrics now serves Prometheus metrics
// All HTTP requests are automatically instrumented with method/route/status_code labels
```

### Tracing

```typescript
import { initTracing } from "@loyaltyos/telemetry";

// Must be called before any other imports
await initTracing("my-service");
// If OTEL_EXPORTER_OTLP_ENDPOINT is not set, this is a no-op
```

## Exported Metrics

| Metric                          | Type      | Labels                     | Description                          |
| ------------------------------- | --------- | -------------------------- | ------------------------------------ |
| `http_requests_total`           | Counter   | method, route, status_code | Total HTTP requests                  |
| `http_request_duration_seconds` | Histogram | method, route, status_code | Request duration (0.01s–10s buckets) |
| `http_errors_total`             | Counter   | method, route              | Total 5xx errors                     |
| `bullmq_queue_depth`            | Gauge     | queue                      | Jobs waiting in queue                |
| `bullmq_job_duration_seconds`   | Histogram | queue                      | Job processing duration              |
| `bullmq_jobs_total`             | Counter   | queue, status              | Jobs by completion status            |
| `nodejs_*`                      | (default) | —                          | Heap, event loop, GC, etc.           |

## Environment Variables

| Variable                      | Description             | Required |
| ----------------------------- | ----------------------- | -------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint | No       |

## API Reference

### `createMetricsRegistry()`

Creates a new Prometheus `Registry` instance.

### `createHttpMetrics(registry)`

Returns `{ httpRequestCounter, httpRequestDuration, httpErrorCounter }` — Counter, Histogram, and Counter for HTTP metrics.

### `createBullMQMetrics(registry)`

Returns `{ bullmqQueueDepth, bullmqJobDuration, bullmqJobCounter }` — Gauge, Histogram, and Counter for BullMQ metrics.

### `setupDefaultMetrics(registry, serviceName)`

Sets `service_name` as default label and enables `collectDefaultMetrics` (prefix: `nodejs_`). Returns the registry.

### `getMetricsContentType()`

Returns `Registry.PROMETHEUS_CONTENT_TYPE` for Content-Type headers.

### `getMetricsPayload(registry)`

Returns the Prometheus text format metrics string.

### `createFastifyMetricsPlugin`

Fastify plugin (wrapped with `fastify-plugin`). Options:

| Option        | Type          | Description                |
| ------------- | ------------- | -------------------------- |
| `registry`    | `Registry`    | Prometheus registry        |
| `httpMetrics` | `HttpMetrics` | From `createHttpMetrics()` |

### `initTracing(serviceName)`

Initializes OpenTelemetry SDK with:

- OTLP HTTP trace exporter (to `OTEL_EXPORTER_OTLP_ENDPOINT`)
- Auto-instrumentations: HTTP, PostgreSQL (`pg`), Redis (`ioredis`)
- Service name and deployment environment resource attributes
- Graceful shutdown on SIGTERM/SIGINT

Returns immediately if `OTEL_EXPORTER_OTLP_ENDPOINT` is not set.

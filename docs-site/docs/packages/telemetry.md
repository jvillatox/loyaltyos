---
sidebar_position: 9
title: Telemetry
---

# Telemetry (`@loyaltyos/telemetry`)

Observability package — OpenTelemetry tracing + Prometheus metrics with zero overhead when disabled.

## Features

- **Prometheus metrics** — HTTP request counters, duration histograms, error counters, BullMQ queue metrics, Node.js default metrics
- **OpenTelemetry tracing** — auto-instruments HTTP, PostgreSQL, and Redis; exports via OTLP HTTP
- **Fastify plugin** — drop-in `/metrics` endpoint with onResponse hook for automatic HTTP metric collection
- **Zero overhead** — all OTEL imports are dynamic; nothing is loaded unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set

## Quick Start

```typescript
import { initTracing } from "@loyaltyos/telemetry";

// Must be first — before any other imports
await initTracing("my-service");

import {
  createMetricsRegistry,
  createHttpMetrics,
  setupDefaultMetrics,
} from "@loyaltyos/telemetry";

const registry = createMetricsRegistry();
setupDefaultMetrics(registry, "my-service");
const httpMetrics = createHttpMetrics(registry);
```

## API

### Metrics

```typescript
// Create a Prometheus registry
createMetricsRegistry(): Registry

// HTTP metrics (counter + histogram + error counter)
createHttpMetrics(registry: Registry): HttpMetrics

// BullMQ metrics (queue depth gauge + job duration histogram + job counter)
createBullMQMetrics(registry: Registry): BullMQMetrics

// Default Node.js metrics + service name label
setupDefaultMetrics(registry: Registry, serviceName: string): Registry

// Prometheus text format
getMetricsContentType(): string
getMetricsPayload(registry: Registry): Promise<string>
```

### Tracing

```typescript
// Initialize OpenTelemetry (no-op if OTEL_EXPORTER_OTLP_ENDPOINT is not set)
initTracing(serviceName: string): Promise<void>
```

### Fastify Plugin

```typescript
import { createFastifyMetricsPlugin } from "@loyaltyos/telemetry";

const app = Fastify();
await app.register(createFastifyMetricsPlugin, { registry, httpMetrics });
// GET /metrics now serves Prometheus metrics
// All HTTP requests are automatically instrumented
```

## Environment Variables

| Variable                      | Description             | Default |
| ----------------------------- | ----------------------- | ------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint | —       |

## Exported Metrics

| Metric                          | Type      | Labels                     |
| ------------------------------- | --------- | -------------------------- |
| `http_requests_total`           | Counter   | method, route, status_code |
| `http_request_duration_seconds` | Histogram | method, route, status_code |
| `http_errors_total`             | Counter   | method, route              |
| `bullmq_queue_depth`            | Gauge     | queue                      |
| `bullmq_job_duration_seconds`   | Histogram | queue                      |
| `bullmq_jobs_total`             | Counter   | queue, status              |
| `nodejs_*`                      | (default) | —                          |

See the [full README on GitHub](https://github.com/jvillatox/loyaltyos/blob/main/packages/telemetry/README.md) for details.

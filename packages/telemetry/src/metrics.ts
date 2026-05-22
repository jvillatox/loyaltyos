import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

export interface MetricsRegistry {
  registry: Registry;
  httpRequestCounter: Counter;
  httpRequestDuration: Histogram;
  httpErrorCounter: Counter;
  bullmqQueueDepth: Gauge;
  bullmqJobDuration: Histogram;
  bullmqJobCounter: Counter;
}

export function createMetricsRegistry(): Registry {
  return new Registry();
}

export function createHttpMetrics(registry: Registry) {
  const labels = ["method", "route", "status_code"] as const;

  const httpRequestCounter = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: labels as unknown as string[],
    registers: [registry],
  });

  const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: labels as unknown as string[],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpErrorCounter = new Counter({
    name: "http_errors_total",
    help: "Total number of HTTP errors (5xx responses)",
    labelNames: ["method", "route"] as unknown as string[],
    registers: [registry],
  });

  return { httpRequestCounter, httpRequestDuration, httpErrorCounter };
}

export function createBullMQMetrics(registry: Registry) {
  const labels = ["queue"] as const;

  const bullmqQueueDepth = new Gauge({
    name: "bullmq_queue_depth",
    help: "Number of jobs waiting in the queue",
    labelNames: labels as unknown as string[],
    registers: [registry],
  });

  const bullmqJobDuration = new Histogram({
    name: "bullmq_job_duration_seconds",
    help: "Job processing duration in seconds",
    labelNames: labels as unknown as string[],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
    registers: [registry],
  });

  const bullmqJobCounter = new Counter({
    name: "bullmq_jobs_total",
    help: "Total number of jobs processed",
    labelNames: ["queue", "status"] as unknown as string[],
    registers: [registry],
  });

  return { bullmqQueueDepth, bullmqJobDuration, bullmqJobCounter };
}

export function setupDefaultMetrics(registry: Registry, serviceName: string): Registry {
  registry.setDefaultLabels({ service_name: serviceName });
  collectDefaultMetrics({ register: registry, prefix: "nodejs_" });
  return registry;
}

export function getMetricsContentType(): string {
  return Registry.PROMETHEUS_CONTENT_TYPE;
}

export async function getMetricsPayload(registry: Registry): Promise<string> {
  return registry.metrics();
}

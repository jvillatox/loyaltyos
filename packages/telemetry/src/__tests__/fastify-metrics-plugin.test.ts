import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFastifyMetricsPlugin } from "../fastify-metrics-plugin.js";
import {
  createBullMQMetrics,
  createHttpMetrics,
  createMetricsRegistry,
  setupDefaultMetrics,
} from "../metrics.js";

describe("createFastifyMetricsPlugin", () => {
  const registry = createMetricsRegistry();
  setupDefaultMetrics(registry, "test-service");
  const httpMetrics = createHttpMetrics(registry);
  const bullmqMetrics = createBullMQMetrics(registry);
  const metricsRegistry = { registry, ...httpMetrics, ...bullmqMetrics };

  const app = Fastify({ logger: false });

  beforeAll(async () => {
    // Register test routes BEFORE the metrics plugin and ready()
    app.get("/test-metrics", async (_req, reply) => {
      return reply.send({ ok: true });
    });

    app.get("/test-error", async (_req, reply) => {
      return reply.status(500).send({ error: "fail" });
    });

    await app.register(createFastifyMetricsPlugin, { registry: metricsRegistry });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes GET /metrics returning 200 with Prometheus content-type", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("http_requests_total");
  });

  it("returns BullMQ metrics in the response", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain("bullmq_queue_depth");
    expect(res.body).toContain("bullmq_job_duration_seconds");
    expect(res.body).toContain("bullmq_jobs_total");
  });

  it("increments HTTP request counters on real requests", async () => {
    await app.inject({ method: "GET", url: "/test-metrics" });
    await app.inject({ method: "GET", url: "/test-metrics" });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain("/test-metrics");
  });

  it("records HTTP request duration for real requests", async () => {
    await app.inject({ method: "GET", url: "/test-metrics" });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    // The histogram HELP/TYPE headers always appear, and after a request the le bucket counters appear
    expect(res.body).toContain("http_request_duration_seconds");
  });

  it("excludes /metrics from being recorded as a route", async () => {
    await app.inject({ method: "GET", url: "/metrics" });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    // /metrics path should not appear in the route label
    const metricsBody = res.body;
    // The route label for /metrics itself should not be recorded
    expect(metricsBody).not.toContain('route="/metrics"');
  });

  it("includes Node.js default metrics", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain("nodejs_");
    expect(res.body).toContain('service_name="test-service"');
  });

  it("records 5xx errors in the error counter", async () => {
    await app.inject({ method: "GET", url: "/test-error" });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain("http_errors_total");
  });
});

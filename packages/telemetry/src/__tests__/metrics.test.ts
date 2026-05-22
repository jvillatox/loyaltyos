import { describe, expect, it } from "vitest";

import {
  createBullMQMetrics,
  createHttpMetrics,
  createMetricsRegistry,
  getMetricsContentType,
  getMetricsPayload,
  setupDefaultMetrics,
} from "../metrics.js";

describe("metrics", () => {
  describe("createMetricsRegistry", () => {
    it("creates a prom-client registry", () => {
      const registry = createMetricsRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.metrics).toBe("function");
    });
  });

  describe("createHttpMetrics", () => {
    it("creates HTTP metrics with correct names", () => {
      const registry = createMetricsRegistry();
      const metrics = createHttpMetrics(registry);

      expect(metrics.httpRequestCounter).toBeDefined();
      expect(metrics.httpRequestDuration).toBeDefined();
      expect(metrics.httpErrorCounter).toBeDefined();
    });

    it("records and increments HTTP request counter", async () => {
      const registry = createMetricsRegistry();
      const metrics = createHttpMetrics(registry);

      metrics.httpRequestCounter.inc({ method: "GET", route: "/test", status_code: "200" });
      metrics.httpRequestCounter.inc({ method: "POST", route: "/test", status_code: "201" });

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain(
        'http_requests_total{method="GET",route="/test",status_code="200"} 1',
      );
      expect(payload).toContain(
        'http_requests_total{method="POST",route="/test",status_code="201"} 1',
      );
    });

    it("records HTTP request duration in histogram", async () => {
      const registry = createMetricsRegistry();
      const metrics = createHttpMetrics(registry);

      metrics.httpRequestDuration.observe(
        { method: "GET", route: "/test", status_code: "200" },
        0.15,
      );

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain("http_request_duration_seconds_bucket");
    });

    it("increments error counter for 5xx responses", async () => {
      const registry = createMetricsRegistry();
      const metrics = createHttpMetrics(registry);

      metrics.httpErrorCounter.inc({ method: "GET", route: "/test" });

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain("http_errors_total");
    });
  });

  describe("createBullMQMetrics", () => {
    it("creates BullMQ metrics with correct names", () => {
      const registry = createMetricsRegistry();
      const metrics = createBullMQMetrics(registry);

      expect(metrics.bullmqQueueDepth).toBeDefined();
      expect(metrics.bullmqJobDuration).toBeDefined();
      expect(metrics.bullmqJobCounter).toBeDefined();
    });

    it("sets queue depth gauge", async () => {
      const registry = createMetricsRegistry();
      const metrics = createBullMQMetrics(registry);

      metrics.bullmqQueueDepth.set({ queue: "notifications_waiting" }, 5);

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain('bullmq_queue_depth{queue="notifications_waiting"} 5');
    });

    it("increments job counter by status", async () => {
      const registry = createMetricsRegistry();
      const metrics = createBullMQMetrics(registry);

      metrics.bullmqJobCounter.inc({ queue: "notifications", status: "completed" });
      metrics.bullmqJobCounter.inc({ queue: "notifications", status: "failed" });

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain("bullmq_jobs_total");
    });
  });

  describe("setupDefaultMetrics", () => {
    it("sets default label and collects Node.js metrics", async () => {
      const registry = createMetricsRegistry();
      const result = setupDefaultMetrics(registry, "test-service");

      expect(result).toBe(registry);

      const payload = await getMetricsPayload(registry);
      // Default metrics include process/nodejs metrics
      expect(payload).toContain('service_name="test-service"');
    });
  });

  describe("getMetricsContentType", () => {
    it("returns Prometheus content type", () => {
      expect(getMetricsContentType()).toBe("text/plain; version=0.0.4; charset=utf-8");
    });
  });

  describe("getMetricsPayload", () => {
    it("returns a non-empty string", async () => {
      const registry = createMetricsRegistry();
      const payload = await getMetricsPayload(registry);
      expect(typeof payload).toBe("string");
      expect(payload.length).toBeGreaterThan(0);
    });
  });
});

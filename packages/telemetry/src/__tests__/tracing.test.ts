import { describe, it } from "vitest";

import { initTracing } from "../tracing.js";

describe("initTracing", () => {
  it("returns immediately when OTEL_EXPORTER_OTLP_ENDPOINT is not set", async () => {
    // Ensure the env var is not set
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    // Should not throw
    await initTracing("test-service");
  });

  it("does not error when called multiple times", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    await initTracing("test-1");
    await initTracing("test-2");
  });
});

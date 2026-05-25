import { McpToolError } from "./errors.js";

interface WindowEntry {
  timestamps: number[];
}

export class RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly maxRpm: number;
  private readonly windowMs = 60_000;

  constructor(maxRpm: number) {
    this.maxRpm = maxRpm;
  }

  /** Check if the given key is within the rate limit. Throws McpToolError if exceeded. */
  check(key: string): void {
    const now = Date.now();
    let entry = this.windows.get(key);

    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Purge expired timestamps
    const cutoff = now - this.windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxRpm) {
      const oldest = entry.timestamps[0];
      if (oldest === undefined) return;
      const retryAfterMs = oldest - cutoff;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      throw new McpToolError(
        `Rate limit exceeded. ${String(this.maxRpm)} requests per minute allowed. Retry after ${String(retryAfterSec)}s.`,
        "UPSTREAM_ERROR",
        { retryAfterSec },
      );
    }

    entry.timestamps.push(now);
    // Clean up empty entries periodically
    if (entry.timestamps.length === 0) {
      this.windows.delete(key);
    }
  }

  /** Reset all windows (useful for testing). */
  reset(): void {
    this.windows.clear();
  }
}

const rpm = Number(process.env.MCP_RATE_LIMIT_RPM ?? "100");
export const defaultRateLimiter = new RateLimiter(rpm);

import { describe, expect, it } from "vitest";

import { formatCurrency, formatDate, formatNumber, formatPoints } from "../format.js";

describe("formatDate", () => {
  it("formats a date in en-US format", () => {
    const date = new Date("2026-05-27T12:00:00Z");
    const result = formatDate(date, "en-US");
    // en-US long date style: "May 27, 2026"
    expect(result).toContain("May");
    expect(result).toContain("27");
    expect(result).toContain("2026");
  });

  it("formats a date in es-MX format", () => {
    const date = new Date("2026-05-27T12:00:00Z");
    const result = formatDate(date, "es-MX");
    // es-MX long date style: "27 de mayo de 2026"
    expect(result).toContain("27");
    expect(result).toContain("mayo");
    expect(result).toContain("2026");
  });

  it("accepts a string date", () => {
    const result = formatDate("2026-01-15T00:00:00Z", "en-US");
    expect(result).toContain("January");
    expect(result).toContain("2026");
  });
});

describe("formatCurrency", () => {
  it("formats USD in en-US", () => {
    const result = formatCurrency(19.99, "USD", "en-US");
    expect(result).toBe("$19.99");
  });

  it("formats MXN in es-MX", () => {
    const result = formatCurrency(500, "MXN", "es-MX");
    expect(result).toContain("500");
    expect(result).toContain("$");
  });

  it("formats negative amounts", () => {
    const result = formatCurrency(-10.5, "USD", "en-US");
    expect(result).toContain("-");
    expect(result).toContain("10.50");
  });
});

describe("formatNumber", () => {
  it("formats with thousand separators in en-US", () => {
    const result = formatNumber(1234567, "en-US");
    expect(result).toBe("1,234,567");
  });

  it("formats with thousand separators in es-MX", () => {
    const result = formatNumber(1234567, "es-MX");
    expect(result).toBe("1,234,567");
  });
});

describe("formatPoints", () => {
  it("formats points with separators and pts suffix", () => {
    const result = formatPoints(1500, "es-MX");
    expect(result).toContain("1,500");
    expect(result).toContain("pts");
  });

  it("formats zero points", () => {
    const result = formatPoints(0, "en-US");
    expect(result).toContain("0");
    expect(result).toContain("pts");
  });
});

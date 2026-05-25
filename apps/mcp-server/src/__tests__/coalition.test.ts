import { describe, expect, it } from "vitest";

import {
  CoalitionAccumulateSchema,
  CoalitionBalanceSchema,
  CoalitionConvertSchema,
} from "../tools/coalition.js";

describe("CoalitionBalanceSchema", () => {
  it("requires memberId", () => {
    const result = CoalitionBalanceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts valid memberId", () => {
    const result = CoalitionBalanceSchema.safeParse({ memberId: "mem_1" });
    expect(result.success).toBe(true);
  });

  it("rejects empty memberId", () => {
    const result = CoalitionBalanceSchema.safeParse({ memberId: "" });
    expect(result.success).toBe(false);
  });
});

describe("CoalitionAccumulateSchema", () => {
  it("accepts required fields", () => {
    const result = CoalitionAccumulateSchema.safeParse({
      memberId: "mem_1",
      points: 100,
      transactionRef: "tx_123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects points less than 1", () => {
    const result = CoalitionAccumulateSchema.safeParse({
      memberId: "mem_1",
      points: 0,
      transactionRef: "tx_123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional metadata", () => {
    const result = CoalitionAccumulateSchema.safeParse({
      memberId: "mem_1",
      points: 50,
      transactionRef: "tx_456",
      metadata: { amount: 5000, store: "online" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing transactionRef", () => {
    const result = CoalitionAccumulateSchema.safeParse({
      memberId: "mem_1",
      points: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe("CoalitionConvertSchema", () => {
  it("accepts valid conversion", () => {
    const result = CoalitionConvertSchema.safeParse({
      memberId: "mem_1",
      ownPoints: 500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects ownPoints less than 1", () => {
    const result = CoalitionConvertSchema.safeParse({
      memberId: "mem_1",
      ownPoints: 0,
    });
    expect(result.success).toBe(false);
  });
});

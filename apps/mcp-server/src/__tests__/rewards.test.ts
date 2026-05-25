import { describe, expect, it } from "vitest";

import {
  RewardCreateSchema,
  RewardRedemptionStatsSchema,
  RewardsCatalogSchema,
} from "../tools/rewards.js";

describe("RewardsCatalogSchema", () => {
  it("defaults limit to 20 and availableOnly to true", () => {
    const result = RewardsCatalogSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.availableOnly).toBe(true);
    }
  });

  it("accepts type filter", () => {
    const result = RewardsCatalogSchema.safeParse({ type: "discount" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const result = RewardsCatalogSchema.safeParse({ type: "invalid_type" });
    expect(result.success).toBe(false);
  });

  it("accepts maxCost and offset", () => {
    const result = RewardsCatalogSchema.safeParse({ maxCost: 500, offset: 10 });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    const result = RewardsCatalogSchema.safeParse({ limit: 200 });
    expect(result.success).toBe(false);
  });
});

describe("RewardCreateSchema", () => {
  it("accepts required fields", () => {
    const result = RewardCreateSchema.safeParse({
      name: "10% Discount Voucher",
      description: "Get 10% off your next purchase",
      type: "discount",
      pointCost: 500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects pointCost less than 1", () => {
    const result = RewardCreateSchema.safeParse({
      name: "Free item",
      description: "A free product",
      type: "product",
      pointCost: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts all optional fields", () => {
    const result = RewardCreateSchema.safeParse({
      name: "Exclusive Experience",
      description: "VIP access to summer event",
      type: "experience",
      pointCost: 5000,
      stock: 100,
      imageUrl: "https://example.com/image.png",
      availableFromDate: "2024-06-01T00:00:00Z",
      availableUntilDate: "2024-08-01T00:00:00Z",
      tierRestriction: ["gold", "platinum"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const result = RewardCreateSchema.safeParse({
      name: "Bad Reward",
      description: "Bad",
      type: "invalid",
      pointCost: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = RewardCreateSchema.safeParse({
      name: "",
      description: "Something",
      type: "discount",
      pointCost: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe("RewardRedemptionStatsSchema", () => {
  it("defaults period to 30d", () => {
    const result = RewardRedemptionStatsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe("30d");
    }
  });

  it("accepts optional rewardId", () => {
    const result = RewardRedemptionStatsSchema.safeParse({ rewardId: "rew_1" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid period", () => {
    const result = RewardRedemptionStatsSchema.safeParse({ period: "15d" });
    expect(result.success).toBe(false);
  });
});

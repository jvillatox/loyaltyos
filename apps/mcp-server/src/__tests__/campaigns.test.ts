import { describe, expect, it } from "vitest";

import {
  CampaignActivateSchema,
  CampaignCreateSchema,
  CampaignGetSchema,
  CampaignPauseSchema,
  CampaignsListSchema,
} from "../tools/campaigns.js";

describe("CampaignCreateSchema", () => {
  it("defaults status to draft", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Double Points Weekend",
      type: "bonus_points",
      startDate: "2024-06-01T00:00:00Z",
      rules: { multiplier: 2 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("draft");
      expect(result.data.stackable).toBe(false);
    }
  });

  it("accepts status active", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Double Points Weekend",
      type: "bonus_points",
      startDate: "2024-06-01T00:00:00Z",
      rules: { multiplier: 2 },
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("rejects name over 100 chars", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "x".repeat(101),
      type: "bonus_points",
      startDate: "2024-06-01T00:00:00Z",
      rules: { multiplier: 2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "",
      type: "bonus_points",
      startDate: "2024-06-01T00:00:00Z",
      rules: { multiplier: 2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid campaign type", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Test",
      type: "invalid_type",
      startDate: "2024-06-01T00:00:00Z",
      rules: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts spend_and_get type with rules", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Spend $50 Get 100 Points",
      type: "spend_and_get",
      startDate: "2024-06-01T00:00:00Z",
      rules: { spendAmount: 50, earnPoints: 100 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts flash_sale type", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Flash 4x Points",
      type: "flash_sale",
      startDate: "2024-06-01T00:00:00Z",
      endDate: "2024-06-02T00:00:00Z",
      rules: { multiplier: 4, maxUsesPerMember: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Full Config Campaign",
      type: "frequency",
      startDate: "2024-06-01T00:00:00Z",
      endDate: "2024-07-01T00:00:00Z",
      segmentId: "seg_1",
      rules: { visits: 5, windowDays: 30, bonusPoints: 200 },
      stackable: true,
      budgetCap: 10000,
      status: "draft",
    });
    expect(result.success).toBe(true);
  });
});

describe("CampaignsListSchema", () => {
  it("defaults limit to 20 and offset to 0", () => {
    const result = CampaignsListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("filters by status", () => {
    const result = CampaignsListSchema.safeParse({ status: "active" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = CampaignsListSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("CampaignGetSchema", () => {
  it("requires campaignId", () => {
    const result = CampaignGetSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts valid campaignId", () => {
    const result = CampaignGetSchema.safeParse({ campaignId: "cam_1" });
    expect(result.success).toBe(true);
  });
});

describe("CampaignActivateSchema", () => {
  it("requires campaignId", () => {
    const result = CampaignActivateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("CampaignPauseSchema", () => {
  it("accepts campaignId with optional reason", () => {
    const result = CampaignPauseSchema.safeParse({
      campaignId: "cam_1",
      reason: "Budget exceeded",
    });
    expect(result.success).toBe(true);
  });

  it("accepts campaignId without reason", () => {
    const result = CampaignPauseSchema.safeParse({ campaignId: "cam_1" });
    expect(result.success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  SegmentCreateSchema,
  SegmentPreviewSchema,
  SegmentsListSchema,
} from "../tools/segments.js";

describe("SegmentCreateSchema", () => {
  it("accepts valid segment with rules", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "High Value Gold Members",
      rules: [{ field: "tier", operator: "eq", value: "gold" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logic).toBe("AND");
    }
  });

  it("rejects empty rules array", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Empty Rules",
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing rules", () => {
    const result = SegmentCreateSchema.safeParse({ name: "No Rules" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid field", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Bad Rules",
      rules: [{ field: "invalidField", operator: "eq", value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid operator", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Bad Operator",
      rules: [{ field: "pointBalance", operator: "contains", value: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts OR logic", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Gold OR Silver",
      description: "Members in gold or silver tiers",
      rules: [
        { field: "tier", operator: "eq", value: "gold" },
        { field: "tier", operator: "eq", value: "silver" },
      ],
      logic: "OR",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid logic", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Bad Logic",
      rules: [{ field: "tier", operator: "eq", value: "gold" }],
      logic: "XOR",
    });
    expect(result.success).toBe(false);
  });
});

describe("SegmentPreviewSchema", () => {
  it("accepts rules and defaults sampleSize to 5", () => {
    const result = SegmentPreviewSchema.safeParse({
      rules: [{ field: "inactiveDays", operator: "gte", value: 60 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sampleSize).toBe(5);
      expect(result.data.logic).toBe("AND");
    }
  });

  it("accepts custom sampleSize", () => {
    const result = SegmentPreviewSchema.safeParse({
      rules: [{ field: "pointBalance", operator: "gt", value: 1000 }],
      sampleSize: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects sampleSize over 20", () => {
    const result = SegmentPreviewSchema.safeParse({
      rules: [{ field: "pointBalance", operator: "gt", value: 1000 }],
      sampleSize: 50,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty rules", () => {
    const result = SegmentPreviewSchema.safeParse({ rules: [] });
    expect(result.success).toBe(false);
  });
});

describe("SegmentsListSchema", () => {
  it("accepts empty object", () => {
    const result = SegmentsListSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

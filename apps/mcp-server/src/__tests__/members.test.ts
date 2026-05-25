import { describe, expect, it } from "vitest";

import {
  MemberAdjustPointsSchema,
  MemberBadgesSchema,
  MemberGetSchema,
  MemberPointsHistorySchema,
  MembersListSchema,
} from "../tools/members.js";

describe("MemberGetSchema", () => {
  it("accepts valid memberId", () => {
    const result = MemberGetSchema.safeParse({ memberId: "mem_1" });
    expect(result.success).toBe(true);
  });

  it("rejects empty memberId", () => {
    const result = MemberGetSchema.safeParse({ memberId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing memberId", () => {
    const result = MemberGetSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("MembersListSchema", () => {
  it("defaults limit to 20 and offset to 0", () => {
    const result = MembersListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("rejects limit over 100", () => {
    const result = MembersListSchema.safeParse({ limit: 200 });
    expect(result.success).toBe(false);
  });

  it("accepts valid filters", () => {
    const result = MembersListSchema.safeParse({
      tier: "gold",
      inactiveDays: 30,
      minBalance: 100,
      maxBalance: 5000,
      search: "Alice",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid tier", () => {
    const result = MembersListSchema.safeParse({ tier: "diamond" });
    expect(result.success).toBe(false);
  });
});

describe("MemberPointsHistorySchema", () => {
  it("accepts memberId with defaults", () => {
    const result = MemberPointsHistorySchema.safeParse({ memberId: "mem_1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects invalid type", () => {
    const result = MemberPointsHistorySchema.safeParse({ memberId: "mem_1", type: "transfer" });
    expect(result.success).toBe(false);
  });

  it("accepts valid filters", () => {
    const result = MemberPointsHistorySchema.safeParse({
      memberId: "mem_1",
      type: "earn",
      startDate: "2024-01-01",
      endDate: "2024-06-01",
    });
    expect(result.success).toBe(true);
  });
});

describe("MemberAdjustPointsSchema", () => {
  it("accepts valid adjustment", () => {
    const result = MemberAdjustPointsSchema.safeParse({
      memberId: "mem_1",
      amount: 500,
      note: "Customer service compensation for delayed order",
    });
    expect(result.success).toBe(true);
  });

  it("rejects note shorter than 10 chars", () => {
    const result = MemberAdjustPointsSchema.safeParse({
      memberId: "mem_1",
      amount: 500,
      note: "Short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing note", () => {
    const result = MemberAdjustPointsSchema.safeParse({
      memberId: "mem_1",
      amount: 500,
    });
    expect(result.success).toBe(false);
  });

  it("accepts negative amount for deduction", () => {
    const result = MemberAdjustPointsSchema.safeParse({
      memberId: "mem_1",
      amount: -200,
      note: "Reversing incorrect credit from support ticket #12345",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional idempotencyKey", () => {
    const result = MemberAdjustPointsSchema.safeParse({
      memberId: "mem_1",
      amount: 100,
      note: "Manual adjustment for loyalty event",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid idempotencyKey format", () => {
    const result = MemberAdjustPointsSchema.safeParse({
      memberId: "mem_1",
      amount: 100,
      note: "Manual adjustment for loyalty event",
      idempotencyKey: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("MemberBadgesSchema", () => {
  it("defaults includeProgress to false", () => {
    const result = MemberBadgesSchema.safeParse({ memberId: "mem_1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeProgress).toBe(false);
    }
  });

  it("accepts includeProgress true", () => {
    const result = MemberBadgesSchema.safeParse({ memberId: "mem_1", includeProgress: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeProgress).toBe(true);
    }
  });
});

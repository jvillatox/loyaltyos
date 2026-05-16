import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  segment: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  pointAccount: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  memberTier: {
    findMany: vi.fn(),
  },
}));

vi.mock("@prisma/client", () => ({}));

let SegmentsService: typeof import("../service.js").SegmentsService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../service.js");
  SegmentsService = mod.SegmentsService;
});

function segmentRow(overrides = {}) {
  return {
    id: "seg-1",
    programId: "prog-1",
    name: "VIP Segment",
    description: null,
    type: "DYNAMIC" as const,
    rules: { all: [{ field: "totalSpent", gte: 50000 }] },
    memberIds: [] as string[],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function memberRow(overrides = {}) {
  return {
    id: "mem-1",
    programId: "prog-1",
    email: "test@example.com",
    phone: null,
    firstName: "Test",
    lastName: "User",
    metadata: {},
    tags: [] as string[],
    joinedAt: new Date("2024-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

// ── SegmentsService ──────────────────────────────────────

describe("SegmentsService.create", () => {
  it("creates a DYNAMIC segment with rules", async () => {
    mockPrisma.segment.create.mockResolvedValue(segmentRow());

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.create({
      programId: "prog-1",
      name: "VIP Segment",
      type: "DYNAMIC",
      rules: { all: [{ field: "totalSpent", gte: 50000 }] },
    });

    expect(result.name).toBe("VIP Segment");
    expect(mockPrisma.segment.create).toHaveBeenCalled();
  });

  it("creates a STATIC segment with memberIds", async () => {
    mockPrisma.segment.create.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1", "mem-2"], rules: {} }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.create({
      programId: "prog-1",
      name: "Manual List",
      type: "STATIC",
      memberIds: ["mem-1", "mem-2"],
    });

    expect(result.type).toBe("STATIC");
  });

  it("rejects DYNAMIC segment without rules", async () => {
    const svc = new SegmentsService(mockPrisma as never);
    await expect(
      svc.create({
        programId: "prog-1",
        name: "Bad Segment",
        type: "DYNAMIC",
      }),
    ).rejects.toThrow();
  });
});

describe("SegmentsService.update", () => {
  it("updates segment name and description", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());
    mockPrisma.segment.update.mockResolvedValue(
      segmentRow({ name: "Updated", description: "New desc" }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.update("seg-1", {
      name: "Updated",
      description: "New desc",
    });

    expect(result.name).toBe("Updated");
  });

  it("throws SegmentNotFoundError for non-existent id", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(null);

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.update("nonexistent", { name: "Nope" })).rejects.toThrow("Segment not found");
  });
});

describe("SegmentsService.delete", () => {
  it("sets isActive to false", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());
    mockPrisma.segment.update.mockResolvedValue(segmentRow({ isActive: false }));

    const svc = new SegmentsService(mockPrisma as never);
    await svc.delete("seg-1");

    expect(mockPrisma.segment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "seg-1" },
      }),
    );
  });
});

describe("SegmentsService.getById", () => {
  it("returns segment when found", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.getById("seg-1");

    expect(result.id).toBe("seg-1");
  });

  it("throws SegmentNotFoundError when not found", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(null);

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.getById("nonexistent")).rejects.toThrow("Segment not found");
  });
});

describe("SegmentsService.list", () => {
  it("returns paginated list", async () => {
    mockPrisma.segment.findMany.mockResolvedValue([segmentRow()]);
    mockPrisma.segment.count.mockResolvedValue(1);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.list("prog-1");

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("filters by type", async () => {
    mockPrisma.segment.findMany.mockResolvedValue([]);
    mockPrisma.segment.count.mockResolvedValue(0);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.list("prog-1", { type: "STATIC" });

    expect(result.items).toHaveLength(0);
  });
});

// ── evaluate ─────────────────────────────────────────────

describe("SegmentsService.evaluate", () => {
  it("returns belongsTo:true for DYNAMIC segment with matching rules", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());
    mockPrisma.member.findFirst.mockResolvedValue(memberRow());
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      totalEarned: 100000,
      totalRedeemed: 25000,
    });
    mockPrisma.memberTier.findMany.mockResolvedValue([
      { downgradedAt: null, tier: { name: "Gold" } },
    ]);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.evaluate("mem-1", "seg-1");

    expect(result.belongsTo).toBe(true);
  });

  it("returns belongsTo:false when totalSpent is below threshold", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());
    mockPrisma.member.findFirst.mockResolvedValue(memberRow());
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      totalEarned: 10000,
      totalRedeemed: 5000,
    });
    mockPrisma.memberTier.findMany.mockResolvedValue([]);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.evaluate("mem-1", "seg-1");

    expect(result.belongsTo).toBe(false);
  });

  it("returns belongsTo:true for STATIC segment when memberId is in list", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1", "mem-2"], rules: {} }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.evaluate("mem-1", "seg-1");

    expect(result.belongsTo).toBe(true);
  });

  it("returns belongsTo:false for STATIC segment when memberId not in list", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-2", "mem-3"], rules: {} }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.evaluate("mem-1", "seg-1");

    expect(result.belongsTo).toBe(false);
  });

  it("throws SegmentNotActiveError when segment is inactive", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow({ isActive: false }));

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.evaluate("mem-1", "seg-1")).rejects.toThrow("Segment is not active");
  });

  it("throws SegmentNotFoundError when segment not found", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(null);

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.evaluate("mem-1", "nonexistent")).rejects.toThrow("Segment not found");
  });
});

// ── getMembers ───────────────────────────────────────────

describe("SegmentsService.getMembers", () => {
  it("returns paginated members for STATIC segment", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1", "mem-2"], rules: {} }),
    );
    mockPrisma.member.findMany.mockResolvedValue([
      { ...memberRow({ id: "mem-1" }), pointAccount: null, memberTiers: [] },
      { ...memberRow({ id: "mem-2" }), pointAccount: null, memberTiers: [] },
    ]);
    mockPrisma.member.count.mockResolvedValue(2);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.getMembers("seg-1");

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("returns empty for DYNAMIC segment with no rules", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow({ rules: {} }));

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.getMembers("seg-1");

    expect(result.items).toHaveLength(0);
  });

  it("uses Prisma where for DYNAMIC segment without computed fields", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({
        rules: { all: [{ field: "email", contains: "@example.com" }] },
      }),
    );
    mockPrisma.member.findMany.mockResolvedValue([
      { ...memberRow(), pointAccount: null, memberTiers: [] },
    ]);
    mockPrisma.member.count.mockResolvedValue(1);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.getMembers("seg-1");

    expect(result.items).toHaveLength(1);
  });

  it("uses in-memory filter for DYNAMIC segment with totalSpent", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({
        rules: { all: [{ field: "totalSpent", gte: 50000 }] },
      }),
    );
    mockPrisma.member.findMany.mockResolvedValue([
      memberRow({ id: "mem-1" }),
      memberRow({ id: "mem-2" }),
    ]);
    // findMembersWithAccounts uses include
    mockPrisma.member.findMany.mockResolvedValue([
      {
        ...memberRow({ id: "mem-1" }),
        pointAccount: { totalEarned: 100000, totalRedeemed: 25000 },
        memberTiers: [{ downgradedAt: null, tier: { name: "Gold" } }],
      },
      {
        ...memberRow({ id: "mem-2" }),
        pointAccount: { totalEarned: 10000, totalRedeemed: 5000 },
        memberTiers: [],
      },
    ]);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.getMembers("seg-1");

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe("mem-1");
  });

  it("throws SegmentNotFoundError", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(null);

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.getMembers("nonexistent")).rejects.toThrow("Segment not found");
  });
});

// ── count ────────────────────────────────────────────────

describe("SegmentsService.count", () => {
  it("returns memberIds.length for STATIC segment", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1", "mem-2", "mem-3"], rules: {} }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.count("seg-1");

    expect(result).toBe(3);
  });

  it("returns 0 for DYNAMIC segment with no rules", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow({ rules: {} }));

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.count("seg-1");

    expect(result).toBe(0);
  });

  it("counts via Prisma for DYNAMIC without computed fields", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({
        rules: { all: [{ field: "email", contains: "@example.com" }] },
      }),
    );
    mockPrisma.member.count.mockResolvedValue(5);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.count("seg-1");

    expect(result).toBe(5);
  });

  it("counts in-memory for DYNAMIC with totalSpent", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({
        rules: { all: [{ field: "totalSpent", gte: 50000 }] },
      }),
    );
    mockPrisma.member.findMany.mockResolvedValue([
      {
        ...memberRow({ id: "mem-1" }),
        pointAccount: { totalEarned: 100000, totalRedeemed: 25000 },
        memberTiers: [{ downgradedAt: null, tier: { name: "Gold" } }],
      },
    ]);

    const svc = new SegmentsService(mockPrisma as never);
    const result = await svc.count("seg-1");

    expect(result).toBe(1);
  });
});

// ── addMembers / removeMembers ───────────────────────────

describe("SegmentsService.addMembers", () => {
  it("adds memberIds to STATIC segment", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1"], rules: {} }),
    );
    mockPrisma.segment.update.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1", "mem-2", "mem-3"], rules: {} }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    await svc.addMembers("seg-1", ["mem-2", "mem-3"]);

    expect(mockPrisma.segment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "seg-1" },
        data: { memberIds: { push: ["mem-2", "mem-3"] } },
      }),
    );
  });

  it("throws SegmentNotStaticError for DYNAMIC segment", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.addMembers("seg-1", ["mem-1"])).rejects.toThrow("not STATIC");
  });
});

describe("SegmentsService.removeMembers", () => {
  it("removes memberIds from STATIC segment", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1", "mem-2", "mem-3"], rules: {} }),
    );
    mockPrisma.segment.update.mockResolvedValue(
      segmentRow({ type: "STATIC", memberIds: ["mem-1"], rules: {} }),
    );

    const svc = new SegmentsService(mockPrisma as never);
    await svc.removeMembers("seg-1", ["mem-2", "mem-3"]);

    expect(mockPrisma.segment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "seg-1" } }),
    );
  });

  it("throws SegmentNotStaticError for DYNAMIC segment", async () => {
    mockPrisma.segment.findFirst.mockResolvedValue(segmentRow());

    const svc = new SegmentsService(mockPrisma as never);
    await expect(svc.removeMembers("seg-1", ["mem-1"])).rejects.toThrow("not STATIC");
  });
});

// ── Rule evaluator unit tests ────────────────────────────

import { evaluateRulesInContext } from "../rule-evaluator.js";

describe("evaluateRulesInContext", () => {
  const ctx = {
    totalSpent: 75000,
    currentTier: "Gold",
    tags: ["vip"],
    joinedAt: new Date("2024-01-01").getTime(),
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
  };

  it("returns true for empty rules", () => {
    expect(evaluateRulesInContext({}, ctx)).toBe(true);
    expect(evaluateRulesInContext(null, ctx)).toBe(true);
  });

  it("matches all conditions in an all group", () => {
    const rules = {
      all: [
        { field: "totalSpent", gte: 50000 },
        { field: "currentTier", eq: "Gold" },
      ],
    };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("rejects when one all condition fails", () => {
    const rules = {
      all: [
        { field: "totalSpent", gte: 50000 },
        { field: "currentTier", eq: "Silver" },
      ],
    };
    expect(evaluateRulesInContext(rules, ctx)).toBe(false);
  });

  it("matches when any condition matches in an any group", () => {
    const rules = {
      any: [
        { field: "currentTier", eq: "Silver" },
        { field: "currentTier", eq: "Gold" },
      ],
    };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("rejects when no any conditions match", () => {
    const rules = {
      any: [
        { field: "currentTier", eq: "Silver" },
        { field: "currentTier", eq: "Bronze" },
      ],
    };
    expect(evaluateRulesInContext(rules, ctx)).toBe(false);
  });

  it("matches nested all inside any", () => {
    const rules = {
      any: [
        { field: "currentTier", eq: "Silver" },
        {
          all: [
            { field: "totalSpent", gte: 50000 },
            { field: "currentTier", eq: "Gold" },
          ],
        },
      ],
    };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("handles between operator", () => {
    const rules = { all: [{ field: "totalSpent", between: [50000, 100000] }] };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("handles in operator", () => {
    const rules = { all: [{ field: "currentTier", in: ["Gold", "Platinum"] }] };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("handles contains operator on strings", () => {
    const rules = { all: [{ field: "email", contains: "@example" }] };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("handles neq operator", () => {
    const rules = { all: [{ field: "currentTier", neq: "Bronze" }] };
    expect(evaluateRulesInContext(rules, ctx)).toBe(true);
  });

  it("handles date comparison with gt", () => {
    const oldDate = new Date("2020-01-01").getTime();
    const ctxOld = { ...ctx, joinedAt: oldDate };
    const rules = { all: [{ field: "joinedAt", gt: new Date("2021-01-01").getTime() }] };
    expect(evaluateRulesInContext(rules, ctxOld)).toBe(false);
  });
});

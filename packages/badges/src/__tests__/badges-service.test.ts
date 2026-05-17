import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  badge: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  pointAccount: {
    findFirst: vi.fn(),
  },
  memberTier: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  memberBadge: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  event: {
    findMany: vi.fn(),
  },
}));

vi.mock("@prisma/client", () => ({}));

let BadgesService: typeof import("../badges-service.js").BadgesService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../badges-service.js");
  BadgesService = mod.BadgesService;
});

// ── Helpers ─────────────────────────────────────────

function badgeRow(overrides = {}) {
  return {
    id: "badge-1",
    programId: "prog-1",
    name: "First Purchase",
    description: "Awarded on first purchase",
    type: "ACHIEVEMENT" as const,
    imageUrl: null,
    tierId: null,
    conditions: { all: [{ field: "totalSpent", gte: 5000 }] },
    seriesId: null,
    seriesPosition: null,
    isActive: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function memberAggregate() {
  return {
    id: "mem-1",
    programId: "prog-1",
    email: "test@example.com",
    phone: null,
    firstName: "Test",
    lastName: "User",
    tags: [],
    joinedAt: new Date("2024-01-01"),
    deletedAt: null,
    totalEarned: 0,
    totalRedeemed: 0,
    currentBalance: 0,
    currentTier: null,
    currentTierId: null,
    currentTierRank: null,
    eventCounts: {},
    totalSpent: 0,
    lastEventAt: null,
  };
}

function service() {
  return new BadgesService(mockPrisma as never);
}

// ── Tests ───────────────────────────────────────────

describe("BadgesService.create", () => {
  it("creates an ACHIEVEMENT badge", async () => {
    const input = {
      programId: "prog-1",
      name: "Big Spender",
      type: "ACHIEVEMENT" as const,
      conditions: { all: [{ field: "totalSpent", gte: 10000 }] },
    };
    const expected = badgeRow({
      id: "badge-new",
      name: "Big Spender",
      conditions: input.conditions,
    });
    mockPrisma.badge.create.mockResolvedValue(expected);

    const result = await service().create(input);
    expect(result.name).toBe("Big Spender");
    expect(result.type).toBe("ACHIEVEMENT");
    expect(mockPrisma.badge.create).toHaveBeenCalledOnce();
  });

  it("creates a SOCIAL badge with series", async () => {
    const input = {
      programId: "prog-1",
      name: "Social Butterfly",
      type: "SOCIAL" as const,
      seriesId: "social-series",
      seriesPosition: 1,
    };
    mockPrisma.badge.create.mockResolvedValue(badgeRow(input));

    const result = await service().create(input);
    expect(result.type).toBe("SOCIAL");
    expect(result.seriesId).toBe("social-series");
  });
});

describe("BadgesService.evaluateOnEvent", () => {
  it("unlocks badge when event reaches threshold", async () => {
    const badge = badgeRow({
      id: "badge-purchase",
      conditions: { all: [{ field: "totalSpent", gte: 5000 }] },
    });
    const agg = memberAggregate();
    agg.totalSpent = 10000;
    agg.totalEarned = 10000;

    mockPrisma.badge.findMany.mockResolvedValue([badge]);
    mockPrisma.member.findFirst.mockResolvedValue({
      ...agg,
      pointAccount: { totalEarned: 10000, totalRedeemed: 0, balance: 10000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.pointAccount.findFirst.mockResolvedValue(null);
    mockPrisma.memberTier.findMany.mockResolvedValue([]);
    mockPrisma.event.findMany.mockResolvedValue([
      { type: "purchase", createdAt: new Date(), payload: { amount: 10000 } },
    ]);
    mockPrisma.memberBadge.findMany.mockResolvedValue([]);
    mockPrisma.memberBadge.upsert.mockResolvedValue({
      id: "mb-1",
      memberId: "mem-1",
      badgeId: badge.id,
      progress: 100,
      unlockedAt: new Date(),
      notifiedAt: null,
      createdAt: new Date(),
      badge,
    });

    const event = { type: "purchase", memberId: "mem-1", programId: "prog-1", amount: 10000 };
    const result = await service().evaluateOnEvent(event);

    expect(result.unlocked).toHaveLength(1);
    expect(result.unlocked[0]!.name).toBe("First Purchase");
  });

  it("skips already unlocked badges", async () => {
    const badge = badgeRow({
      conditions: { all: [{ field: "totalSpent", gte: 5000 }] },
    });
    const agg = memberAggregate();
    agg.totalSpent = 10000;
    agg.totalEarned = 10000;

    mockPrisma.badge.findMany.mockResolvedValue([badge]);
    mockPrisma.member.findFirst.mockResolvedValue({
      ...agg,
      pointAccount: { totalEarned: 10000, totalRedeemed: 0, balance: 10000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.memberBadge.findMany.mockResolvedValue([
      { memberId: "mem-1", badgeId: badge.id, unlockedAt: new Date(), progress: 100 },
    ]);
    mockPrisma.memberBadge.upsert.mockResolvedValue({
      id: "mb-1",
      memberId: "mem-1",
      badgeId: badge.id,
      progress: 100,
      unlockedAt: new Date(),
      notifiedAt: null,
      createdAt: new Date(),
      badge,
    });

    const event = { type: "purchase", memberId: "mem-1", programId: "prog-1" };
    const result = await service().evaluateOnEvent(event);

    expect(result.unlocked).toHaveLength(0);
    expect(result.progress.length).toBeGreaterThanOrEqual(1);
    expect(result.progress[0]!.unlocked).toBe(true);
  });

  it("shows in-progress badge when threshold not met", async () => {
    const badge = badgeRow({
      conditions: { all: [{ field: "totalSpent", gte: 100000 }] },
    });
    const agg = memberAggregate();
    agg.totalSpent = 25000;
    agg.totalEarned = 25000;

    mockPrisma.badge.findMany.mockResolvedValue([badge]);
    mockPrisma.member.findFirst.mockResolvedValue({
      ...agg,
      pointAccount: { totalEarned: 25000, totalRedeemed: 0, balance: 25000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.memberBadge.findMany.mockResolvedValue([]);
    mockPrisma.memberBadge.upsert.mockResolvedValue({
      id: "mb-1",
      memberId: "mem-1",
      badgeId: badge.id,
      progress: 25,
      unlockedAt: null,
      notifiedAt: null,
      createdAt: new Date(),
      badge,
    });

    const event = { type: "purchase", memberId: "mem-1", programId: "prog-1" };
    const result = await service().evaluateOnEvent(event);

    expect(result.unlocked).toHaveLength(0);
    expect(result.progress[0]!.progress).toBe(25);
    expect(result.progress[0]!.unlocked).toBe(false);
  });
});

describe("BadgesService.progress", () => {
  it("returns progress for a specific badge", async () => {
    const badge = badgeRow({
      conditions: { all: [{ field: "totalEarned", gte: 20000 }] },
    });
    const agg = memberAggregate();
    agg.totalEarned = 10000;

    mockPrisma.badge.findFirst.mockResolvedValue(badge);
    mockPrisma.member.findFirst.mockResolvedValue({
      ...agg,
      pointAccount: { totalEarned: 10000, totalRedeemed: 0, balance: 10000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.memberBadge.findUnique.mockResolvedValue(null);

    const result = await service().progress("mem-1", "badge-1");
    expect(result).not.toBeNull();
    expect(result!.progress).toBe(50);
    expect(result!.targetValue).toBe(20000);
    expect(result!.unlocked).toBe(false);
  });

  it("returns null for non-existent member", async () => {
    mockPrisma.badge.findFirst.mockResolvedValue(badgeRow());
    mockPrisma.member.findFirst.mockResolvedValue(null);

    const result = await service().progress("bad-member", "badge-1");
    expect(result).toBeNull();
  });
});

describe("BadgesService.award", () => {
  it("awards a badge to a member manually", async () => {
    const badge = badgeRow();
    mockPrisma.badge.findFirst.mockResolvedValue(badge);
    mockPrisma.memberBadge.findUnique.mockResolvedValue(null);
    mockPrisma.memberBadge.upsert.mockResolvedValue({
      id: "mb-award",
      memberId: "mem-1",
      badgeId: badge.id,
      progress: 100,
      unlockedAt: new Date(),
      notifiedAt: null,
      createdAt: new Date(),
      badge,
    });

    const result = await service().award("mem-1", "badge-1", "admin");
    expect(result.id).toBe("mb-award");
  });

  it("throws if badge already awarded", async () => {
    const badge = badgeRow();
    mockPrisma.badge.findFirst.mockResolvedValue(badge);
    mockPrisma.memberBadge.findUnique.mockResolvedValue({
      id: "mb-exists",
      memberId: "mem-1",
      badgeId: badge.id,
      progress: 100,
      unlockedAt: new Date(),
      notifiedAt: null,
      createdAt: new Date(),
      badge,
    });

    await expect(service().award("mem-1", "badge-1", "admin")).rejects.toThrow("already awarded");
  });
});

describe("BadgesService.getMemberBadges", () => {
  it("returns all active badges with progress for a member", async () => {
    const badge1 = badgeRow({ id: "badge-1", type: "ACHIEVEMENT" as const });
    const badge2 = badgeRow({ id: "badge-2", type: "STATUS" as const, name: "VIP Status" });

    mockPrisma.member.findFirst.mockResolvedValue({
      id: "mem-1",
      programId: "prog-1",
      deletedAt: null,
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      tags: [],
      joinedAt: new Date(),
      pointAccount: { totalEarned: 10000, totalRedeemed: 0, balance: 10000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.badge.findMany.mockResolvedValue([badge1, badge2]);
    mockPrisma.memberBadge.findMany.mockResolvedValue([]);
    mockPrisma.event.findMany.mockResolvedValue([]);

    const result = await service().getMemberBadges("mem-1");
    expect(result).toHaveLength(2);
    expect(result[0]!.badge.type).toBe("ACHIEVEMENT");
    expect(result[1]!.badge.name).toBe("VIP Status");
  });
});

describe("BadgesService CRUD", () => {
  it("lists badges with pagination", async () => {
    mockPrisma.badge.findMany.mockResolvedValue([badgeRow()]);
    mockPrisma.badge.count.mockResolvedValue(1);

    const result = await service().list("prog-1", { page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("throws BadgeNotFoundError on getById of non-existent badge", async () => {
    mockPrisma.badge.findFirst.mockResolvedValue(null);
    await expect(service().getById("bad-badge")).rejects.toThrow("Badge not found");
  });
});

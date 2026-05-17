import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  tier: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
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
    create: vi.fn(),
    update: vi.fn(),
  },
  event: {
    findMany: vi.fn(),
  },
}));

vi.mock("@prisma/client", () => ({}));

let TiersService: typeof import("../tiers-service.js").TiersService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../tiers-service.js");
  TiersService = mod.TiersService;
});

function tierRow(overrides = {}) {
  return {
    id: "tier-1",
    programId: "prog-1",
    name: "Silver",
    rank: 1,
    minPoints: 0,
    color: "#94a3b8",
    iconUrl: null,
    benefits: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function service() {
  return new TiersService(mockPrisma as never);
}

// ── Tests ───────────────────────────────────────────

describe("TiersService.create", () => {
  it("creates a tier", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(null);
    mockPrisma.tier.create.mockResolvedValue(tierRow());

    const result = await service().create({
      programId: "prog-1",
      name: "Silver",
      rank: 1,
      minPoints: 0,
    });

    expect(result.name).toBe("Silver");
    expect(result.rank).toBe(1);
  });

  it("throws TierRankConflictError if rank already taken", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow());

    await expect(
      service().create({ programId: "prog-1", name: "Gold", rank: 1, minPoints: 5000 }),
    ).rejects.toThrow("already exists");
  });
});

describe("TiersService.evaluateMember", () => {
  it("assigns first eligible tier when member has no tier", async () => {
    mockPrisma.tier.findMany.mockResolvedValue([
      tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
      tierRow({ id: "tier-2", name: "Gold", rank: 2, minPoints: 5000 }),
      tierRow({ id: "tier-3", name: "Platinum", rank: 3, minPoints: 20000 }),
    ]);

    mockPrisma.member.findFirst.mockResolvedValue({
      id: "mem-1",
      programId: "prog-1",
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      tags: [],
      joinedAt: new Date(),
      deletedAt: null,
      pointAccount: { totalEarned: 10000, totalRedeemed: 0, balance: 10000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.pointAccount.findFirst.mockResolvedValue(null);
    mockPrisma.memberTier.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    mockPrisma.memberTier.create.mockResolvedValue({
      id: "mt-1",
      memberId: "mem-1",
      tierId: "tier-2",
      upgradedAt: new Date(),
      downgradedAt: null,
      tier: tierRow({ id: "tier-2", name: "Gold", rank: 2, minPoints: 5000 }),
    });

    const result = await service().evaluateMember("mem-1", "prog-1");
    expect(result.changed).toBe(true);
    expect(result.direction).toBe("upgrade");
    expect(result.currentTier?.name).toBe("Gold");
  });

  it("stays in same tier if points haven't reached next level", async () => {
    mockPrisma.tier.findMany.mockResolvedValue([
      tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
      tierRow({ id: "tier-2", name: "Gold", rank: 2, minPoints: 5000 }),
    ]);

    mockPrisma.member.findFirst.mockResolvedValue({
      id: "mem-1",
      programId: "prog-1",
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      tags: [],
      joinedAt: new Date(),
      deletedAt: null,
      pointAccount: { totalEarned: 3000, totalRedeemed: 0, balance: 3000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findFirst.mockResolvedValue({
      id: "mt-1",
      memberId: "mem-1",
      tierId: "tier-1",
      upgradedAt: new Date(),
      downgradedAt: null,
      tier: tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
    });

    const result = await service().evaluateMember("mem-1", "prog-1");
    expect(result.changed).toBe(false);
    expect(result.currentTier?.name).toBe("Silver");
  });

  it("upgrades member when points cross threshold", async () => {
    mockPrisma.tier.findMany.mockResolvedValue([
      tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
      tierRow({ id: "tier-2", name: "Gold", rank: 2, minPoints: 5000 }),
    ]);

    mockPrisma.member.findFirst.mockResolvedValue({
      id: "mem-1",
      programId: "prog-1",
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      tags: [],
      joinedAt: new Date(),
      deletedAt: null,
      pointAccount: { totalEarned: 12000, totalRedeemed: 0, balance: 12000, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findFirst.mockResolvedValue({
      id: "mt-silver",
      memberId: "mem-1",
      tierId: "tier-1",
      upgradedAt: new Date("2024-01-01"),
      downgradedAt: null,
      tier: tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
    });
    mockPrisma.memberTier.create.mockResolvedValue({
      id: "mt-gold",
      memberId: "mem-1",
      tierId: "tier-2",
      upgradedAt: new Date(),
      downgradedAt: null,
      tier: tierRow({ id: "tier-2", name: "Gold", rank: 2, minPoints: 5000 }),
    });

    const result = await service().evaluateMember("mem-1", "prog-1");
    expect(result.changed).toBe(true);
    expect(result.direction).toBe("upgrade");
    expect(result.currentTier?.name).toBe("Gold");
  });

  it("returns progress to next tier", async () => {
    mockPrisma.tier.findMany.mockResolvedValue([
      tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
      tierRow({ id: "tier-2", name: "Gold", rank: 2, minPoints: 5000 }),
    ]);

    mockPrisma.member.findFirst.mockResolvedValue({
      id: "mem-1",
      programId: "prog-1",
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      tags: [],
      joinedAt: new Date(),
      deletedAt: null,
      pointAccount: { totalEarned: 2500, totalRedeemed: 0, balance: 2500, pendingBalance: 0 },
      memberTiers: [],
    });
    mockPrisma.event.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findMany.mockResolvedValue([]);
    mockPrisma.memberTier.findFirst.mockResolvedValue({
      id: "mt-1",
      memberId: "mem-1",
      tierId: "tier-1",
      upgradedAt: new Date(),
      downgradedAt: null,
      tier: tierRow({ id: "tier-1", name: "Silver", rank: 1, minPoints: 0 }),
    });

    const result = await service().evaluateMember("mem-1", "prog-1");
    expect(result.pointsProgress).toBe(50); // 2500/5000
    expect(result.pointsToNext).toBe(2500);
    expect(result.nextTier?.name).toBe("Gold");
  });
});

describe("TiersService.benefits", () => {
  it("returns tier benefits", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(
      tierRow({ benefits: { multiplier: 1.5, freeShipping: true } }),
    );

    const benefits = await service().benefits("tier-1");
    expect(benefits).toEqual({ multiplier: 1.5, freeShipping: true });
  });

  it("returns empty object for no benefits", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow({ benefits: null }));

    const benefits = await service().benefits("tier-1");
    expect(benefits).toEqual({});
  });

  it("throws TierNotFoundError for non-existent tier", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(null);
    await expect(service().benefits("bad-tier")).rejects.toThrow("Tier not found");
  });
});

describe("TiersService.reorder", () => {
  it("updates ranks based on new order", async () => {
    const tiers = [
      tierRow({ id: "tier-a", name: "Gold", rank: 1 }),
      tierRow({ id: "tier-b", name: "Silver", rank: 2 }),
      tierRow({ id: "tier-c", name: "Bronze", rank: 3 }),
    ];
    mockPrisma.tier.findMany.mockResolvedValue(tiers);
    mockPrisma.tier.update.mockResolvedValue(tierRow());

    await service().reorder("prog-1", ["tier-c", "tier-a", "tier-b"]);
    // Tier C gets rank 1, A gets 2, B gets 3
    expect(mockPrisma.tier.update).toHaveBeenCalledTimes(3);
  });
});

describe("TiersService.getCurrentTier", () => {
  it("returns current tier for a member", async () => {
    const t = tierRow({ name: "Gold", rank: 2 });
    mockPrisma.memberTier.findFirst.mockResolvedValue({
      id: "mt-1",
      memberId: "mem-1",
      tierId: "tier-1",
      upgradedAt: new Date(),
      downgradedAt: null,
      tier: t,
    });

    const result = await service().getCurrentTier("mem-1");
    expect(result?.name).toBe("Gold");
  });

  it("returns null if member has no tier", async () => {
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    const result = await service().getCurrentTier("mem-1");
    expect(result).toBeNull();
  });
});

describe("TiersService CRUD", () => {
  it("lists tiers ordered by rank", async () => {
    mockPrisma.tier.findMany.mockResolvedValue([
      tierRow({ id: "t-1", name: "Silver", rank: 1 }),
      tierRow({ id: "t-2", name: "Gold", rank: 2 }),
    ]);

    const result = await service().list("prog-1");
    expect(result).toHaveLength(2);
  });

  it("throws TierNotFoundError on getById of non-existent tier", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(null);
    await expect(service().getById("bad-tier")).rejects.toThrow("Tier not found");
  });

  it("deletes a tier", async () => {
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow());
    mockPrisma.tier.delete.mockResolvedValue(tierRow());

    await expect(service().delete("tier-1")).resolves.toBeUndefined();
  });
});

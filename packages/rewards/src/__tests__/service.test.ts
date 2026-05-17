import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  reward: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  rewardRedemption: {
    create: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  memberTier: {
    findFirst: vi.fn(),
  },
  tier: {
    findFirst: vi.fn(),
  },
  pointAccount: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  pointTransaction: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

let RewardsService: typeof import("../service.js").RewardsService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../service.js");
  RewardsService = mod.RewardsService;
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function rewardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rew-1",
    programId: "prog-1",
    name: "Free Coffee",
    description: "A delicious coffee",
    pointsCost: 500,
    stock: 10,
    imageUrl: null,
    category: "PHYSICAL_PRODUCT",
    tierRequired: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    redemptions: [],
    ...overrides,
  };
}

function redemptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "red-1",
    rewardId: "rew-1",
    memberId: "mem-1",
    pointsSpent: 500,
    redeemedAt: new Date("2024-01-01"),
    metadata: {},
    ...overrides,
  };
}

function tierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tier-1",
    programId: "prog-1",
    name: "Gold",
    rank: 3,
    minPoints: 1000,
    color: null,
    iconUrl: null,
    benefits: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function memberTierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mt-1",
    memberId: "mem-1",
    tierId: "tier-1",
    upgradedAt: new Date("2024-01-01"),
    downgradedAt: null,
    tier: tierRow(),
    ...overrides,
  };
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

describe("RewardsService.create", () => {
  it("creates a reward", async () => {
    mockPrisma.reward.create.mockResolvedValue(rewardRow());

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.create({
      programId: "prog-1",
      name: "Free Coffee",
      pointsCost: 500,
      stock: 10,
    });

    expect(result.name).toBe("Free Coffee");
    expect(mockPrisma.reward.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Free Coffee", pointsCost: 500 }),
    });
  });
});

describe("RewardsService.update", () => {
  it("updates reward fields", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow());
    mockPrisma.reward.update.mockResolvedValue(rewardRow({ pointsCost: 600 }));

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.update("rew-1", { pointsCost: 600 });

    expect(result.pointsCost).toBe(600);
  });

  it("throws RewardNotFoundError for non-existent reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.update("nonexistent", { pointsCost: 600 })).rejects.toThrow(
      "Reward not found",
    );
  });
});

describe("RewardsService.softDelete", () => {
  it("soft-deletes a reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow());

    const svc = new RewardsService(mockPrisma as never);
    await svc.softDelete("rew-1");

    expect(mockPrisma.reward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rew-1" },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it("throws RewardNotFoundError for non-existent reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.softDelete("nonexistent")).rejects.toThrow("Reward not found");
  });
});

describe("RewardsService.archive", () => {
  it("archives a reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow());

    const svc = new RewardsService(mockPrisma as never);
    await svc.archive("rew-1");

    expect(mockPrisma.reward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rew-1" },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });
});

describe("RewardsService.publish", () => {
  it("publishes a reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ isActive: false }));
    mockPrisma.reward.update.mockResolvedValue(rewardRow({ isActive: true }));

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.publish("rew-1");

    expect(result.isActive).toBe(true);
  });
});

describe("RewardsService.restock", () => {
  it("restocks a reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 10 }));
    mockPrisma.reward.update.mockResolvedValue(rewardRow({ stock: 20 }));

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.restock("rew-1", 10);

    expect(result.stock).toBe(20);
    expect(mockPrisma.reward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rew-1" },
        data: { stock: { increment: 10 } },
      }),
    );
  });
});

describe("RewardsService.getById", () => {
  it("returns a reward by id", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow());

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.getById("rew-1");

    expect(result.id).toBe("rew-1");
  });

  it("throws RewardNotFoundError for non-existent reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.getById("nonexistent")).rejects.toThrow("Reward not found");
  });
});

// ── Public catalog ──────────────────────────────────────────────────────────

describe("RewardsService.list", () => {
  it("returns paginated rewards for a program", async () => {
    mockPrisma.reward.findMany.mockResolvedValue([rewardRow()]);
    mockPrisma.reward.count.mockResolvedValue(1);

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.list("prog-1", {});

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("applies category filter", async () => {
    mockPrisma.reward.findMany.mockResolvedValue([]);
    mockPrisma.reward.count.mockResolvedValue(0);

    const svc = new RewardsService(mockPrisma as never);
    await svc.list("prog-1", { category: "GIFT_CARD" });

    expect(mockPrisma.reward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "GIFT_CARD" }),
      }),
    );
  });

  it("applies points range filter", async () => {
    mockPrisma.reward.findMany.mockResolvedValue([]);
    mockPrisma.reward.count.mockResolvedValue(0);

    const svc = new RewardsService(mockPrisma as never);
    await svc.list("prog-1", { minPoints: 100, maxPoints: 1000 });

    expect(mockPrisma.reward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pointsCost: { gte: 100, lte: 1000 },
        }),
      }),
    );
  });
});

describe("RewardsService.detail", () => {
  it("returns reward detail without member", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow());

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.detail("rew-1");

    expect(result.id).toBe("rew-1");
  });

  it("returns reward with eligibility when memberId provided", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 10 }));
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 1000 });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.detail("rew-1", "mem-1");

    expect(result.eligible).toBe(true);
  });

  it("returns ineligible when reward is inactive", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ isActive: false }));

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.detail("rew-1", "mem-1");

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("not active");
  });

  it("throws RewardNotFoundError for non-existent reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.detail("nonexistent")).rejects.toThrow("Reward not found");
  });
});

// ── Eligibility ─────────────────────────────────────────────────────────────

describe("RewardsService.checkEligibility", () => {
  it("returns eligible for active, stocked reward with enough points", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 5 }));
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 1000 });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.checkEligibility("rew-1", "mem-1");

    expect(result.eligible).toBe(true);
  });

  it("throws RewardNotActiveError for inactive reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ isActive: false }));

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.checkEligibility("rew-1", "mem-1")).rejects.toThrow("not active");
  });

  it("throws RewardOutOfStockError when stock is 0", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 0 }));

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.checkEligibility("rew-1", "mem-1")).rejects.toThrow("out of stock");
  });

  it("allows unlimited stock (null)", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: null }));
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 1000 });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.checkEligibility("rew-1", "mem-1");

    expect(result.eligible).toBe(true);
  });

  it("throws RewardTierInsufficientError when member tier is too low", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(
      rewardRow({ tierRequired: "Platinum", stock: 5 }),
    );
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow({ name: "Platinum", rank: 5 }));
    mockPrisma.memberTier.findFirst.mockResolvedValue(memberTierRow());

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.checkEligibility("rew-1", "mem-1")).rejects.toThrow("Tier");
  });

  it("throws RewardTierInsufficientError when member has no tier", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ tierRequired: "Gold", stock: 5 }));
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow({ name: "Gold", rank: 3 }));
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.checkEligibility("rew-1", "mem-1")).rejects.toThrow("Tier");
  });

  it("passes tier check when member rank equals required rank", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ tierRequired: "Gold", stock: 5 }));
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow({ name: "Gold", rank: 3 }));
    mockPrisma.memberTier.findFirst.mockResolvedValue(
      memberTierRow({ tier: tierRow({ name: "Gold", rank: 3 }) }),
    );
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 1000 });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.checkEligibility("rew-1", "mem-1");

    expect(result.eligible).toBe(true);
  });

  it("passes tier check when member rank exceeds required rank", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ tierRequired: "Silver", stock: 5 }));
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow({ name: "Silver", rank: 2 }));
    mockPrisma.memberTier.findFirst.mockResolvedValue(
      memberTierRow({ tier: tierRow({ name: "Gold", rank: 3 }) }),
    );
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 1000 });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.checkEligibility("rew-1", "mem-1");

    expect(result.eligible).toBe(true);
  });

  it("throws RewardInsufficientPointsError when balance is too low", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ pointsCost: 1000, stock: 5 }));
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 100 });

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.checkEligibility("rew-1", "mem-1")).rejects.toThrow("Insufficient points");
  });

  it("throws RewardNotFoundError for non-existent reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.checkEligibility("nonexistent", "mem-1")).rejects.toThrow("Reward not found");
  });
});

// ── Redeem ──────────────────────────────────────────────────────────────────

describe("RewardsService.redeem", () => {
  it("successfully redeems a reward with tracked stock", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 5 }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);
    mockPrisma.reward.update.mockResolvedValue(rewardRow({ stock: 4 }));
    mockPrisma.rewardRedemption.create.mockResolvedValue(redemptionRow());
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    // First pointAccount.findFirst = findMemberBalance (balance check)
    // Second pointAccount.findFirst = findOrCreateAccount (inside PointsService)
    mockPrisma.pointAccount.findFirst
      .mockResolvedValueOnce({ balance: 1000 })
      .mockResolvedValueOnce({ id: "acc-1", balance: 1000, pendingBalance: 0 });
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-1",
      amount: 500,
      balanceAfter: 500,
    });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.redeem("rew-1", "mem-1", "idem-1");

    expect(result.redemption.id).toBe("red-1");
    expect(result.transaction.transactionId).toBe("tx-1");
    expect(result.transaction.idempotent).toBe(false);
    expect(mockPrisma.reward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rew-1", stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      }),
    );
    expect(mockPrisma.pointTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "REDEEM",
          amount: 500,
          source: "reward:rew-1",
          idempotencyKey: "idem-1",
        }),
      }),
    );
  });

  it("redeems with unlimited stock", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: null }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);
    mockPrisma.rewardRedemption.create.mockResolvedValue(redemptionRow());
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst
      .mockResolvedValueOnce({ balance: 1000 })
      .mockResolvedValueOnce({ id: "acc-2", balance: 1500, pendingBalance: 0 });
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-2",
      amount: 500,
      balanceAfter: 1000,
    });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.redeem("rew-1", "mem-1", "idem-2");

    expect(result.redemption.id).toBe("red-1");
    expect(mockPrisma.reward.update).not.toHaveBeenCalled();
  });

  it("returns idempotent result when redemption exists", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 5 }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(
      redemptionRow({ metadata: { idempotencyKey: "idem-3" } }),
    );
    // PointsService finds existing tx → idempotent
    mockPrisma.pointTransaction.findUnique.mockResolvedValue({
      id: "tx-1",
      amount: 500,
      balanceAfter: 500,
    });

    const svc = new RewardsService(mockPrisma as never);
    const result = await svc.redeem("rew-1", "mem-1", "idem-3");

    expect(result.transaction.idempotent).toBe(true);
    expect(mockPrisma.reward.update).not.toHaveBeenCalled();
    expect(mockPrisma.rewardRedemption.create).not.toHaveBeenCalled();
  });

  it("throws RewardNotActiveError for inactive reward", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ isActive: false }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.redeem("rew-1", "mem-1", "idem-4")).rejects.toThrow("not active");
  });

  it("throws RewardOutOfStockError when stock is 0", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 0 }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.redeem("rew-1", "mem-1", "idem-5")).rejects.toThrow("out of stock");
  });

  it("throws RewardOutOfStockError on concurrent stock exhaustion", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 1 }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);
    mockPrisma.reward.update.mockResolvedValue(null);
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 1000 });

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.redeem("rew-1", "mem-1", "idem-6")).rejects.toThrow("out of stock");
  });

  it("throws RewardInsufficientPointsError when balance is low", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ pointsCost: 1000, stock: 5 }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({ balance: 100 });

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.redeem("rew-1", "mem-1", "idem-7")).rejects.toThrow("Insufficient points");
  });

  it("rolls back stock and redemption when PointsService fails", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(rewardRow({ stock: 5 }));
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);
    mockPrisma.reward.update
      .mockResolvedValueOnce(rewardRow({ stock: 4 })) // decrement
      .mockResolvedValueOnce(rewardRow({ stock: 5 })); // rollback increment
    mockPrisma.rewardRedemption.create.mockResolvedValue(redemptionRow());
    mockPrisma.memberTier.findFirst.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst
      .mockResolvedValueOnce({ balance: 1000 })
      .mockResolvedValueOnce({ id: "acc-1", balance: 1000, pendingBalance: 0 });
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    // Fail inside PointsService
    mockPrisma.pointTransaction.create.mockRejectedValue(new Error("Points engine error"));

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.redeem("rew-1", "mem-1", "idem-8")).rejects.toThrow("Points engine error");

    // Stock should be restored
    expect(mockPrisma.reward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stock: { increment: 1 } },
      }),
    );
    // Redemption should be deleted
    expect(mockPrisma.rewardRedemption.delete).toHaveBeenCalledWith({
      where: { id: "red-1" },
    });
  });

  it("enforces tier requirement", async () => {
    mockPrisma.reward.findFirst.mockResolvedValue(
      rewardRow({ tierRequired: "Platinum", stock: 5 }),
    );
    mockPrisma.rewardRedemption.findFirst.mockResolvedValue(null);
    mockPrisma.tier.findFirst.mockResolvedValue(tierRow({ name: "Platinum", rank: 5 }));
    mockPrisma.memberTier.findFirst.mockResolvedValue(memberTierRow());

    const svc = new RewardsService(mockPrisma as never);
    await expect(svc.redeem("rew-1", "mem-1", "idem-9")).rejects.toThrow("Tier");
  });
});

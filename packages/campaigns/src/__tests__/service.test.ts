import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  campaign: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  campaignApplication: {
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  member: {
    count: vi.fn(),
  },
};

const mockPointsService = {
  earn: vi.fn(),
  balance: vi.fn(),
};

let CampaignsService: typeof import("../service.js").CampaignsService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../service.js");
  CampaignsService = mod.CampaignsService;
  // Reset points service mock
  mockPointsService.earn.mockReset();
  mockPointsService.balance.mockReset();
});

function makeCampaign(overrides = {}) {
  return {
    id: "camp-1",
    programId: "prog-1",
    name: "Test Campaign",
    description: null,
    type: "BONUS_POINTS" as const,
    conditions: null,
    multiplier: 2,
    maxBudget: 10000,
    maxUsesPerMember: 5,
    isStackable: false,
    isActive: true,
    abTesting: false,
    startsAt: null,
    endsAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: [],
    ...overrides,
  };
}

describe("CampaignsService.create", () => {
  it("creates a campaign with default values", async () => {
    mockPrisma.campaign.create.mockResolvedValue(makeCampaign());

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.create({
      programId: "prog-1",
      name: "Test Campaign",
      type: "BONUS_POINTS",
    });

    expect(result.name).toBe("Test Campaign");
    expect(mockPrisma.campaign.create).toHaveBeenCalledTimes(1);
  });

  it("creates a campaign with variants", async () => {
    const campaign = makeCampaign({
      abTesting: true,
      variants: [
        {
          id: "v1",
          campaignId: "camp-1",
          name: "Variant A",
          trafficPct: 50,
          config: null,
          createdAt: new Date(),
        },
        {
          id: "v2",
          campaignId: "camp-1",
          name: "Variant B",
          trafficPct: 50,
          config: null,
          createdAt: new Date(),
        },
      ],
    });
    mockPrisma.campaign.create.mockResolvedValue(campaign);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.create({
      programId: "prog-1",
      name: "AB Test",
      type: "BONUS_POINTS",
      abTesting: true,
      variants: [
        { name: "Variant A", trafficPct: 50 },
        { name: "Variant B", trafficPct: 50 },
      ],
    });

    expect(result.variants).toHaveLength(2);
  });
});

describe("CampaignsService.evaluateForEvent", () => {
  it("returns matching campaigns when active and within date range", async () => {
    const campaign = makeCampaign();
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });

    expect(result.applicable).toHaveLength(1);
    const first = result.applicable[0];
    if (!first) throw new Error("Expected at least one applicable campaign");
    expect(first.id).toBe("camp-1");
  });

  it("excludes campaigns outside date range", async () => {
    const pastEnd = makeCampaign({
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2020-12-31"),
    });
    mockPrisma.campaign.findMany.mockResolvedValue([pastEnd]);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });

    expect(result.applicable).toHaveLength(0);
    expect(result.reasons.get("camp-1")).toBe("Campaign has ended");
  });

  it("excludes campaigns with budget exhausted", async () => {
    const campaign = makeCampaign({ maxBudget: 10000 });
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 10000 } });

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });

    expect(result.applicable).toHaveLength(0);
    expect(result.reasons.get("camp-1")).toBe("Budget exhausted");
  });

  it("excludes campaigns when per-member limit reached", async () => {
    const campaign = makeCampaign({ maxUsesPerMember: 3 });
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(3);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });

    expect(result.applicable).toHaveLength(0);
    expect(result.reasons.get("camp-1")).toBe("Per-member limit reached");
  });

  it("evaluates conditions and excludes non-matching", async () => {
    const campaign = makeCampaign({
      conditions: { all: [{ field: "category", eq: "electronics" }] },
    });
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
      payload: { category: "food" },
    });

    expect(result.applicable).toHaveLength(0);
    expect(result.reasons.get("camp-1")).toBe("Conditions not met");
  });

  it("includes campaigns when conditions match", async () => {
    const campaign = makeCampaign({
      conditions: { all: [{ field: "category", eq: "electronics" }] },
    });
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
      payload: { category: "electronics" },
    });

    expect(result.applicable).toHaveLength(1);
  });

  it("assigns A/B variant deterministically", async () => {
    const campaign = makeCampaign({
      abTesting: true,
      variants: [
        {
          id: "v1",
          campaignId: "camp-1",
          name: "A",
          trafficPct: 50,
          config: null,
          createdAt: new Date(),
        },
        {
          id: "v2",
          campaignId: "camp-1",
          name: "B",
          trafficPct: 50,
          config: null,
          createdAt: new Date(),
        },
      ],
    });
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const r1 = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });
    const r2 = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });

    // Same member + same campaign = same variant
    expect(r1.variantAssignments.get("camp-1")).toBe(r2.variantAssignments.get("camp-1"));
  });

  it("excludes campaign not yet started", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const campaign = makeCampaign({ startsAt: future });
    mockPrisma.campaign.findMany.mockResolvedValue([campaign]);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.evaluateForEvent({
      type: "BONUS_POINTS",
      memberId: "mem-1",
      programId: "prog-1",
    });

    expect(result.applicable).toHaveLength(0);
    expect(result.reasons.get("camp-1")).toBe("Campaign has not started yet");
  });
});

describe("CampaignsService.applyCampaign", () => {
  it("applies BONUS_POINTS campaign via pointsService.earn", async () => {
    const campaign = makeCampaign();
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);
    mockPrisma.campaignApplication.create.mockResolvedValue({ id: "app-1" });
    mockPointsService.earn.mockResolvedValue({
      transactionId: "tx-1",
      amount: 100,
      multiplier: 2,
      balanceAfter: 600,
      idempotent: false,
    });

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.applyCampaign("camp-1", {
      type: "purchase",
      memberId: "mem-1",
      programId: "prog-1",
      amount: 100,
    });

    expect(mockPointsService.earn).toHaveBeenCalled();
    expect(result.pointsAwarded).toBe(100);
    expect(result.applicationId).toBe("app-1");
  });

  it("records CampaignApplication for non-BONUS_POINTS type", async () => {
    const campaign = makeCampaign({ type: "FLASH_SALE" as const });
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(0);
    mockPrisma.campaignApplication.create.mockResolvedValue({ id: "app-2" });

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.applyCampaign("camp-1", {
      type: "flash_sale",
      memberId: "mem-1",
      programId: "prog-1",
    });

    expect(mockPointsService.earn).not.toHaveBeenCalled();
    expect(result.pointsAwarded).toBe(0);
    expect(result.applicationId).toBe("app-2");
  });

  it("throws CampaignNotActiveError when paused", async () => {
    const campaign = makeCampaign({ isActive: false });
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await expect(
      svc.applyCampaign("camp-1", {
        type: "purchase",
        memberId: "mem-1",
        programId: "prog-1",
      }),
    ).rejects.toThrow("Campaign is not active");
  });

  it("throws CampaignBudgetExhaustedError when budget depleted", async () => {
    const campaign = makeCampaign({ maxBudget: 10000 });
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 10000 } });

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await expect(
      svc.applyCampaign("camp-1", {
        type: "purchase",
        memberId: "mem-1",
        programId: "prog-1",
      }),
    ).rejects.toThrow("budget exhausted");
  });

  it("throws CampaignUserLimitReachedError when per-member limit hit", async () => {
    const campaign = makeCampaign({ maxUsesPerMember: 2 });
    mockPrisma.campaign.findFirst.mockResolvedValue(campaign);
    mockPrisma.campaignApplication.aggregate.mockResolvedValue({ _sum: { pointsAwarded: 0 } });
    mockPrisma.campaignApplication.count.mockResolvedValue(2);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await expect(
      svc.applyCampaign("camp-1", {
        type: "purchase",
        memberId: "mem-1",
        programId: "prog-1",
      }),
    ).rejects.toThrow("has reached the limit");
  });
});

describe("CampaignsService.lifecycle", () => {
  it("activate sets isActive to true", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(makeCampaign({ isActive: false }));
    mockPrisma.campaign.update.mockResolvedValue(makeCampaign({ isActive: true }));

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await svc.activate("camp-1");

    expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp-1" }, data: { isActive: true } }),
    );
  });

  it("pause sets isActive to false", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(makeCampaign());
    mockPrisma.campaign.update.mockResolvedValue(makeCampaign({ isActive: false }));

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await svc.pause("camp-1");

    expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp-1" }, data: { isActive: false } }),
    );
  });

  it("archive soft-deletes the campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(makeCampaign());

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await svc.archive("camp-1");

    expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "camp-1" } }),
    );
  });
});

describe("CampaignsService.estimateImpact", () => {
  it("returns estimated members and points", async () => {
    mockPrisma.member.count.mockResolvedValue(50);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.estimateImpact({
      programId: "prog-1",
      multiplier: 2,
    });

    expect(result.estimatedMembers).toBe(50);
    expect(result.estimatedPoints).toBe(10000); // 50 * 100 * 2

    const resultWithBudget = await svc.estimateImpact({
      programId: "prog-1",
      multiplier: 2,
      maxBudget: 5000,
    });
    expect(resultWithBudget.estimatedCost).toBe(5000);
  });
});

describe("CampaignsService.update", () => {
  it("updates campaign fields", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(makeCampaign());
    mockPrisma.campaign.update.mockResolvedValue(makeCampaign({ name: "Updated" }));

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    const result = await svc.update("camp-1", { name: "Updated" });

    expect(result.name).toBe("Updated");
  });

  it("throws CampaignNotFoundError when updating non-existent campaign", async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null);

    const svc = new CampaignsService(mockPrisma as never, mockPointsService as never);
    await expect(svc.update("nonexistent", { name: "Nope" })).rejects.toThrow("Campaign not found");
  });
});

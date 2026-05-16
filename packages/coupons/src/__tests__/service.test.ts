import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  coupon: {
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  couponRedemption: {
    create: vi.fn(),
    count: vi.fn(),
  },
};

let CouponsService: typeof import("../service.js").CouponsService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../service.js");
  CouponsService = mod.CouponsService;
});

function couponRow(overrides = {}) {
  return {
    id: "coup-1",
    programId: "prog-1",
    code: "SUMMER20",
    mode: "SHARED" as const,
    discountType: "PERCENTAGE" as const,
    discountValue: 20,
    minPurchase: null,
    maxUses: null,
    maxUsesPerMember: null,
    usedCount: 0,
    isStackable: false,
    channels: [],
    startsAt: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    redemptions: [],
    ...overrides,
  };
}

describe("CouponsService.create", () => {
  it("creates a coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);
    mockPrisma.coupon.create.mockResolvedValue(couponRow());

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.create({
      programId: "prog-1",
      code: "SUMMER20",
      mode: "SHARED",
      discountType: "PERCENTAGE",
      discountValue: 20,
    });

    expect(result.code).toBe("SUMMER20");
  });

  it("throws on duplicate code", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());

    const svc = new CouponsService(mockPrisma as never);
    await expect(
      svc.create({
        programId: "prog-1",
        code: "SUMMER20",
        mode: "SHARED",
        discountType: "PERCENTAGE",
      }),
    ).rejects.toThrow("already exists");
  });
});

describe("CouponsService.validate", () => {
  it("returns valid for active coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.couponRedemption.count.mockResolvedValue(0);

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.validate("SUMMER20", { memberId: "mem-1" });

    expect(result.valid).toBe(true);
    expect(result.discountAmount).toBe(0);
  });

  it("throws CouponNotFoundError for missing coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.validate("BOGUS", { memberId: "mem-1" });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Coupon not found");
  });

  it("throws CouponExpiredError when expired", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ expiresAt: new Date("2020-01-01") }));

    const svc = new CouponsService(mockPrisma as never);
    await expect(svc.validate("SUMMER20", { memberId: "mem-1" })).rejects.toThrow("has expired");
  });

  it("throws CouponNotStartedError when not yet started", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ startsAt: future }));

    const svc = new CouponsService(mockPrisma as never);
    await expect(svc.validate("SUMMER20", { memberId: "mem-1" })).rejects.toThrow(
      "has not started",
    );
  });

  it("throws CouponExhaustedError when maxUses reached", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ maxUses: 100, usedCount: 100 }));

    const svc = new CouponsService(mockPrisma as never);
    await expect(svc.validate("SUMMER20", { memberId: "mem-1" })).rejects.toThrow("usage limit");
  });

  it("throws CouponMemberLimitError when member limit reached", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ maxUsesPerMember: 1 }));
    mockPrisma.couponRedemption.count.mockResolvedValue(1);

    const svc = new CouponsService(mockPrisma as never);
    await expect(svc.validate("SUMMER20", { memberId: "mem-1" })).rejects.toThrow(
      "has exceeded usage limit",
    );
  });

  it("throws CouponMinPurchaseError when purchase below minimum", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ minPurchase: 50000 }));
    mockPrisma.couponRedemption.count.mockResolvedValue(0);

    const svc = new CouponsService(mockPrisma as never);
    await expect(
      svc.validate("SUMMER20", { memberId: "mem-1", purchaseAmount: 10000 }),
    ).rejects.toThrow("minimum purchase");
  });

  it("throws CouponChannelError when channel not allowed", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ channels: ["online", "app"] }));
    mockPrisma.couponRedemption.count.mockResolvedValue(0);

    const svc = new CouponsService(mockPrisma as never);
    await expect(
      svc.validate("SUMMER20", { memberId: "mem-1", channel: "physical" }),
    ).rejects.toThrow("not valid for channel");
  });

  it("computes discount amount for PERCENTAGE", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.couponRedemption.count.mockResolvedValue(0);

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.validate("SUMMER20", {
      memberId: "mem-1",
      purchaseAmount: 50000,
    });

    expect(result.discountAmount).toBe(10000);
  });

  it("computes discount amount for FIXED", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(
      couponRow({ discountType: "FIXED", discountValue: 5000 }),
    );
    mockPrisma.couponRedemption.count.mockResolvedValue(0);

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.validate("SUMMER20", { memberId: "mem-1" });

    expect(result.discountAmount).toBe(5000);
  });
});

describe("CouponsService.redeem", () => {
  it("records redemption and increments used count", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.couponRedemption.count.mockResolvedValue(0);
    mockPrisma.couponRedemption.create.mockResolvedValue({ id: "red-1" });
    mockPrisma.coupon.update.mockResolvedValue(couponRow());

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.redeem("SUMMER20", { memberId: "mem-1" });

    expect(result.redemptionId).toBe("red-1");
    expect(mockPrisma.couponRedemption.create).toHaveBeenCalled();
    expect(mockPrisma.coupon.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usedCount: { increment: 1 } } }),
    );
  });
});

describe("CouponsService.generateCodes", () => {
  it("generates unique codes", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);
    mockPrisma.coupon.createMany.mockResolvedValue({ count: 3 });

    const svc = new CouponsService(mockPrisma as never);
    const codes = await svc.generateCodes({
      programId: "prog-1",
      prefix: "SUMMER",
      count: 3,
      discountType: "PERCENTAGE",
      discountValue: 15,
    });

    expect(codes).toHaveLength(3);
    expect(codes.every((c) => c.startsWith("SUMMER"))).toBe(true);
  });
});

describe("CouponsService.update", () => {
  it("updates coupon fields", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());
    mockPrisma.coupon.update.mockResolvedValue(couponRow({ discountValue: 30 }));

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.update("coup-1", { discountValue: 30 });

    expect(result.discountValue).toBe(30);
  });

  it("throws CouponNotFoundError for non-existent coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const svc = new CouponsService(mockPrisma as never);
    await expect(svc.update("nonexistent", { discountValue: 30 })).rejects.toThrow("not found");
  });
});

describe("CouponsService.delete", () => {
  it("soft-deletes a coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow());

    const svc = new CouponsService(mockPrisma as never);
    await svc.delete("coup-1");

    expect(mockPrisma.coupon.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "coup-1" } }),
    );
  });
});

describe("CouponsService.list", () => {
  it("returns paginated list", async () => {
    mockPrisma.coupon.findMany.mockResolvedValue([couponRow()]);
    mockPrisma.coupon.count.mockResolvedValue(1);

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.list("prog-1", {});

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe("CouponsService.stats", () => {
  it("returns usage statistics", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(couponRow({ maxUses: 100, usedCount: 42 }));

    const svc = new CouponsService(mockPrisma as never);
    const result = await svc.stats("coup-1");

    expect(result.usedCount).toBe(42);
    expect(result.remaining).toBe(58);
    expect(result.isActive).toBe(true);
  });

  it("throws CouponNotFoundError for non-existent coupon", async () => {
    mockPrisma.coupon.findFirst.mockResolvedValue(null);

    const svc = new CouponsService(mockPrisma as never);
    await expect(svc.stats("nonexistent")).rejects.toThrow("not found");
  });
});

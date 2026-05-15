import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AlreadyReversedError,
  InsufficientBalanceError,
  TransactionNotFoundError,
} from "../types.js";

const mockPrisma = {
  pointAccount: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  pointTransaction: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  pointRule: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

// Cast for PointsService constructor; the inferred vi.fn() types satisfy mock setup
const prisma = mockPrisma as unknown as PrismaClient;

// Dynamic import after mock setup
let PointsService: typeof import("../service.js").PointsService;

beforeEach(async () => {
  vi.resetAllMocks();
  const mod = await import("../service.js");
  PointsService = mod.PointsService;
});

describe("PointsService.earn", () => {
  it("creates earn transaction and updates balance", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointRule.findMany.mockResolvedValue([]);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 500,
      pendingBalance: 300,
      totalEarned: 800,
      totalRedeemed: 300,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-1",
      accountId: "acc-1",
      type: "EARN",
      amount: 100,
      balanceAfter: 600,
      source: "purchase",
      idempotencyKey: "ik-earn",
      createdAt: new Date(),
    });

    const svc = new PointsService(prisma);
    const result = await svc.earn({
      memberId: "mem-1",
      programId: "prog-1",
      amount: 100,
      source: "purchase",
      idempotencyKey: "ik-earn",
    });

    expect(result.transactionId).toBe("tx-1");
    expect(result.amount).toBe(100);
    expect(result.balanceAfter).toBe(600);
    expect(result.idempotent).toBe(false);
  });

  it("returns existing result on duplicate idempotency key", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue({
      id: "tx-existing",
      accountId: "acc-1",
      type: "EARN",
      amount: 100,
      balanceAfter: 600,
      source: "purchase",
      idempotencyKey: "ik-earn",
      createdAt: new Date(),
    });

    const svc = new PointsService(prisma);
    const result = await svc.earn({
      memberId: "mem-1",
      programId: "prog-1",
      amount: 100,
      source: "purchase",
      idempotencyKey: "ik-earn",
    });

    expect(result.idempotent).toBe(true);
    expect(result.transactionId).toBe("tx-existing");
    expect(mockPrisma.pointTransaction.create).not.toHaveBeenCalled();
  });

  it("applies active rules multiplier", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 0,
      pendingBalance: 0,
      totalEarned: 0,
      totalRedeemed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.pointRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        programId: "prog-1",
        eventType: "purchase",
        multiplier: 2.0,
        conditions: { category: "electronics" },
        isActive: true,
        startsAt: null,
        endsAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-1",
      amount: 200,
      balanceAfter: 200,
    });

    const svc = new PointsService(prisma);
    const result = await svc.earn({
      memberId: "mem-1",
      programId: "prog-1",
      amount: 100,
      source: "purchase",
      idempotencyKey: "ik-mult",
      metadata: { category: "electronics" },
    });

    expect(result.amount).toBe(200);
    expect(result.multiplier).toBe(2.0);
    expect(result.balanceAfter).toBe(200);
  });

  it("creates account if it doesn't exist", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointRule.findMany.mockResolvedValue([]);
    mockPrisma.pointAccount.findFirst.mockResolvedValue(null); // No account
    mockPrisma.pointAccount.create.mockResolvedValue({
      id: "acc-new",
      memberId: "mem-new",
      programId: "prog-1",
      balance: 0,
      pendingBalance: 0,
      totalEarned: 0,
      totalRedeemed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-1",
      amount: 50,
      balanceAfter: 50,
    });

    const svc = new PointsService(prisma);
    const result = await svc.earn({
      memberId: "mem-new",
      programId: "prog-1",
      amount: 50,
      source: "registration",
      idempotencyKey: "ik-new",
    });

    expect(mockPrisma.pointAccount.create).toHaveBeenCalled();
    expect(result.balanceAfter).toBe(50);
  });
});

describe("PointsService.redeem", () => {
  it("redeems points and decrements balance", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 500,
      pendingBalance: 0,
      totalEarned: 500,
      totalRedeemed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-redeem",
      amount: 200,
      balanceAfter: 300,
    });

    const svc = new PointsService(prisma);
    const result = await svc.redeem({
      memberId: "mem-1",
      programId: "prog-1",
      amount: 200,
      source: "reward",
      idempotencyKey: "ik-redeem",
    });

    expect(result.balanceAfter).toBe(300);
    expect(result.idempotent).toBe(false);
  });

  it("throws InsufficientBalanceError when balance too low", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 50,
      pendingBalance: 0,
      totalEarned: 50,
      totalRedeemed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const svc = new PointsService(prisma);
    await expect(
      svc.redeem({
        memberId: "mem-1",
        programId: "prog-1",
        amount: 200,
        source: "reward",
        idempotencyKey: "ik-fail",
      }),
    ).rejects.toThrow(InsufficientBalanceError);
  });

  it("returns idempotent result", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue({
      id: "tx-existing",
      amount: 200,
      balanceAfter: 300,
    });

    const svc = new PointsService(prisma);
    const result = await svc.redeem({
      memberId: "mem-1",
      programId: "prog-1",
      amount: 200,
      source: "reward",
      idempotencyKey: "ik-existing",
    });

    expect(result.idempotent).toBe(true);
    expect(mockPrisma.pointTransaction.create).not.toHaveBeenCalled();
  });
});

describe("PointsService.reverse", () => {
  it("creates contra-entry without deleting original", async () => {
    const originalTx = {
      id: "tx-orig",
      accountId: "acc-1",
      type: "EARN",
      amount: 100,
      balanceAfter: 100,
      source: "purchase",
      idempotencyKey: "ik-orig",
      createdAt: new Date(),
      description: null,
      metadata: null,
      expiresAt: null,
      settledAt: null,
      reversedFromId: null,
      reversedById: null,
    };

    mockPrisma.pointTransaction.findUnique
      .mockResolvedValueOnce(null) // no existing idempotent match
      .mockResolvedValueOnce(originalTx); // findTxById

    mockPrisma.pointTransaction.findFirst.mockResolvedValue(null); // no existing reversal

    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      memberId: "mem-1",
      programId: "prog-1",
      balance: 100,
      pendingBalance: 0,
      totalEarned: 100,
      totalRedeemed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockPrisma.pointTransaction.create.mockResolvedValue({
      id: "tx-reverse",
      accountId: "acc-1",
      type: "REVERSE",
      amount: 100,
      balanceAfter: 0,
      source: "admin:admin-1",
      idempotencyKey: "reverse-tx-orig-admin-1",
      createdAt: new Date(),
    });

    const svc = new PointsService(prisma);
    const result = await svc.reverse("tx-orig", "mistake", "admin-1");

    expect(result.reversalId).toBe("tx-reverse");
    expect(result.originalType).toBe("EARN");
    expect(result.amountReversed).toBe(100);
    // Original was NOT deleted
    expect(mockPrisma.pointTransaction.create).toHaveBeenCalled();
  });

  it("throws TransactionNotFoundError when original doesn't exist", async () => {
    mockPrisma.pointTransaction.findUnique.mockResolvedValue(null); // no idempotent, no original

    const svc = new PointsService(prisma);
    await expect(svc.reverse("nonexistent", "reason", "admin-1")).rejects.toThrow(
      TransactionNotFoundError,
    );
  });

  it("throws AlreadyReversedError when reversal exists", async () => {
    const originalTx = {
      id: "tx-orig",
      accountId: "acc-1",
      type: "EARN" as const,
      amount: 100,
      balanceAfter: 100,
      source: "purchase",
      idempotencyKey: "ik-orig",
      createdAt: new Date(),
    };

    mockPrisma.pointTransaction.findUnique
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce(originalTx); // find by id

    mockPrisma.pointTransaction.findFirst.mockResolvedValue({
      id: "existing-reversal",
    });

    const svc = new PointsService(prisma);
    await expect(svc.reverse("tx-orig", "reason", "admin-1")).rejects.toThrow(AlreadyReversedError);
  });
});

describe("PointsService.balance", () => {
  it("returns zero for non-existent account", async () => {
    mockPrisma.pointAccount.findFirst.mockResolvedValue(null);

    const svc = new PointsService(prisma);
    const result = await svc.balance("mem-1", "prog-1");

    expect(result).toEqual({ confirmed: 0, pending: 0, total: 0 });
  });

  it("returns balances for existing account", async () => {
    mockPrisma.pointAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      balance: 1000,
      pendingBalance: 200,
    });

    const svc = new PointsService(prisma);
    const result = await svc.balance("mem-1", "prog-1");

    expect(result.confirmed).toBe(1000);
    expect(result.pending).toBe(200);
    expect(result.total).toBe(1200);
  });
});

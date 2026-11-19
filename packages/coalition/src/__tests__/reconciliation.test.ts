import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ─────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  program: {
    count: vi.fn(),
  },
  coalitionConfig: {
    findUnique: vi.fn(),
  },
  coalitionAccount: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  coalitionTransaction: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));

// ── Mock PointsService ──────────────────────────────────────────

const mockEarn = vi.fn();
const mockRedeem = vi.fn();

vi.mock("@loyaltyos/core", () => ({
  PointsService: vi.fn().mockImplementation(() => ({
    earn: mockEarn,
    redeem: mockRedeem,
    balance: vi.fn().mockResolvedValue({ total: 0, confirmed: 0, pending: 0 }),
  })),
}));

// ── Dynamically import after mocks ─────────────────────────────

let CoalitionService: typeof import("../service.js").CoalitionService;
let MockAdapter: typeof import("./mock-adapter.js").MockAdapter;

beforeEach(async () => {
  vi.clearAllMocks();
  mockEarn.mockReset();
  mockRedeem.mockReset();
  const mod = await import("../service.js");
  const adapterMod = await import("./mock-adapter.js");
  CoalitionService = mod.CoalitionService;
  MockAdapter = adapterMod.MockAdapter;
});

// ── Row Factories ──────────────────────────────────────────────

function configRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg-1",
    programId: "prog-1",
    provider: "mock",
    endpoint: "https://mock.coalition.local",
    country: null,
    identifierType: null,
    encryptedCredentials: "encrypted-stuff",
    conversionRate: 1.0,
    accumulationEnabled: true,
    redemptionEnabled: true,
    conversionEnabled: true,
    minConversionPoints: 500,
    circuitState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    memberId: "mem-1",
    programId: "prog-1",
    provider: "mock",
    externalId: "ext-ref-1",
    externalBalance: 0,
    lastSyncedAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function txRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    accountId: "acct-1",
    type: "EARN" as const,
    amount: 100,
    localTxRef: "ref-1",
    externalTxRef: null,
    status: "PENDING",
    attempts: 1,
    lastError: null,
    metadata: null,
    idempotencyKey: "earn-ref-1",
    createdAt: new Date(),
    lastAttemptAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(
  adapter: import("./mock-adapter.js").MockAdapter,
  metrics?: Record<string, unknown>,
) {
  const svc = new CoalitionService(mockPrisma as never, metrics as never);
  svc.registerAdapter(adapter);
  return svc;
}

// ── Tests ──────────────────────────────────────────────────────

describe("reconcilePendingTransaction", () => {
  it("success confirms the transaction", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany.mockResolvedValue({ count: 1 });

    const svc = makeService(new MockAdapter({ externalTxId: "ext-1" }));

    await expect(svc.reconcilePendingTransaction("tx-1")).resolves.toBe("confirmed");
    expect(mockPrisma.coalitionTransaction.update).toHaveBeenCalled();
  });

  it("duplicate-ts with a matching history entry confirms", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany.mockResolvedValue({ count: 1 });

    const adapter = new MockAdapter({
      duplicateTs: true,
      historyEntries: [{ descripcion: "Compra aprobada [LOS:tx-1]" }],
    });
    const svc = makeService(adapter);

    await expect(svc.reconcilePendingTransaction("tx-1")).resolves.toBe("confirmed");
  });

  it("duplicate-ts without a matching history entry needs review (never confirms)", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany.mockResolvedValue({ count: 1 });

    const metrics = { recordNeedsReview: vi.fn(), recordOperation: vi.fn() };
    const adapter = new MockAdapter({ duplicateTs: true, historyEntries: [] });
    const svc = makeService(adapter, metrics);

    await expect(svc.reconcilePendingTransaction("tx-1")).resolves.toBe("needs_review");
    expect(metrics.recordNeedsReview).toHaveBeenCalledWith("mock");
    // The success update must NOT have run.
    expect(mockPrisma.coalitionTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_REVIEW" }) }),
    );
  });

  it("business error fails the transaction", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany.mockResolvedValue({ count: 1 });

    const svc = makeService(new MockAdapter({ businessError: "insufficient funds" }));

    await expect(svc.reconcilePendingTransaction("tx-1")).resolves.toBe("failed");
    expect(mockPrisma.coalitionTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("transient error keeps the transaction pending (not yet confirmed)", async () => {
    const tx = txRow({ createdAt: new Date() });
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany.mockResolvedValue({ count: 1 });

    const svc = makeService(new MockAdapter({ transientFails: 1 }));

    await expect(svc.reconcilePendingTransaction("tx-1")).resolves.toBe("still_pending");
    expect(mockPrisma.coalitionTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) }),
    );
  });

  it("two concurrent instances race and exactly one claims the transaction", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const svcA = makeService(new MockAdapter({ externalTxId: "ext-a" }));
    const svcB = makeService(new MockAdapter({ externalTxId: "ext-b" }));

    const [a, b] = await Promise.all([
      svcA.reconcilePendingTransaction("tx-1"),
      svcB.reconcilePendingTransaction("tx-1"),
    ]);

    expect([a, b].sort()).toEqual(["claimed_by_other", "confirmed"]);
  });
});

describe("manual reconciliation actions", () => {
  it("manuallyRetryTransaction force-retries a NEEDS_REVIEW transaction", async () => {
    const tx = txRow({ status: "NEEDS_REVIEW" });
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
    mockPrisma.coalitionTransaction.updateMany.mockResolvedValue({ count: 1 });

    const svc = makeService(new MockAdapter({ externalTxId: "ext-1" }));

    await expect(svc.manuallyRetryTransaction("prog-1", "tx-1")).resolves.toBe("confirmed");
  });

  it("manuallyConfirmTransaction confirms a PENDING transaction", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());
    mockPrisma.coalitionTransaction.update.mockResolvedValue(txRow({ status: "CONFIRMED" }));

    const svc = makeService(new MockAdapter());

    const result = await svc.manuallyConfirmTransaction("prog-1", "tx-1");
    expect(result.status).toBe("CONFIRMED");
    expect(mockPrisma.coalitionTransaction.update).toHaveBeenCalled();
  });

  it("manuallyFailTransaction fails a PENDING transaction with a comment", async () => {
    const tx = txRow();
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());

    const svc = makeService(new MockAdapter());

    const result = await svc.manuallyFailTransaction("prog-1", "tx-1", "customer dispute");
    expect(result.status).toBe("FAILED");
    expect(mockPrisma.coalitionTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastError: "Manual failure: customer dispute",
        }),
      }),
    );
  });

  it("manual actions reject a transaction that is not PENDING/NEEDS_REVIEW", async () => {
    const tx = txRow({ status: "CONFIRMED" });
    mockPrisma.coalitionTransaction.findUnique.mockResolvedValue(tx);
    mockPrisma.coalitionAccount.findUnique.mockResolvedValue(accountRow());

    const svc = makeService(new MockAdapter());

    await expect(svc.manuallyConfirmTransaction("prog-1", "tx-1")).rejects.toThrow(
      "only PENDING or NEEDS_REVIEW",
    );
    await expect(svc.manuallyFailTransaction("prog-1", "tx-1", "x")).rejects.toThrow(
      "only PENDING or NEEDS_REVIEW",
    );
  });
});

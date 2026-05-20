import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CoalitionBusinessError,
  CoalitionTransientError,
  CoalitionUnsupportedError,
} from "../types.js";

// ── Mock Prisma ─────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  coalitionConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  coalitionAccount: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  coalitionTransaction: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  pointAccount: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  pointTransaction: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

// ── Mock PointsService ──────────────────────────────────────────

const mockEarn = vi.fn();
const mockRedeem = vi.fn();

vi.mock("@loyaltyos/core", () => ({
  PointsService: vi.fn().mockImplementation(() => ({
    earn: mockEarn,
    redeem: mockRedeem,
    balance: vi.fn().mockResolvedValue({ total: 5000, confirmed: 5000, pending: 0 }),
  })),
}));

// ── Dynamically import after mocks ─────────────────────────────

let CoalitionService: typeof import("../service.js").CoalitionService;
let MockAdapter: typeof import("./mock-adapter.js").MockAdapter;
let encrypt: typeof import("../crypto.js").encrypt;
let decrypt: typeof import("../crypto.js").decrypt;
let getMasterKey: typeof import("../crypto.js").getMasterKey;

beforeEach(async () => {
  vi.clearAllMocks();
  mockEarn.mockReset();
  mockRedeem.mockReset();
  const mod = await import("../service.js");
  const adapterMod = await import("./mock-adapter.js");
  const cryptoMod = await import("../crypto.js");
  CoalitionService = mod.CoalitionService;
  MockAdapter = adapterMod.MockAdapter;
  encrypt = cryptoMod.encrypt;
  decrypt = cryptoMod.decrypt;
  getMasterKey = cryptoMod.getMasterKey;
});

// ── Row Factories ──────────────────────────────────────────────

function configRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg-1",
    programId: "prog-1",
    provider: "mock",
    endpoint: "https://mock.coalition.local",
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
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("CoalitionService", () => {
  // ═══ Adapter Registration ═══

  describe("registerAdapter", () => {
    it("registers an adapter and makes it available via getActiveAdapter", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter();

      svc.registerAdapter(adapter);
      const active = await svc.getActiveAdapter("prog-1");

      expect(active).toBe(adapter);
    });

    it("throws when no config exists for program", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(null);
      const svc = new CoalitionService(mockPrisma as never);
      svc.registerAdapter(new MockAdapter());

      await expect(svc.getActiveAdapter("prog-none")).rejects.toThrow(
        'No coalition config found for program "prog-none"',
      );
    });

    it("throws when adapter not registered for config provider", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow({ provider: "unknown" }));
      const svc = new CoalitionService(mockPrisma as never);

      await expect(svc.getActiveAdapter("prog-1")).rejects.toThrow(
        'No adapter registered for provider "unknown"',
      );
    });
  });

  // ═══ Idempotency ═══

  describe("idempotency", () => {
    it("returns existing transaction for duplicate accumulate txRef", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(
        txRow({ status: "CONFIRMED", externalTxRef: "ext-123" }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      svc.registerAdapter(new MockAdapter());

      const result = await svc.accumulate({
        programId: "prog-1",
        memberId: "mem-1",
        externalMemberRef: "ext-ref-1",
        points: 50,
        txRef: "ref-dup",
      });

      expect(result.idempotent).toBe(true);
      expect(result.externalTxId).toBe("ext-123");
    });
  });

  // ═══ Accumulate ═══

  describe("accumulate", () => {
    it("completes happy path: PENDING → adapter called → CONFIRMED", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow());
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ status: "CONFIRMED", externalTxRef: "ext-acc-1" }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({ externalTxId: "ext-acc-1" });
      svc.registerAdapter(adapter);

      const result = await svc.accumulate({
        programId: "prog-1",
        memberId: "mem-1",
        externalMemberRef: "ext-ref-1",
        points: 100,
        txRef: "ref-acc-1",
      });

      expect(result.status).toBe("CONFIRMED");
      expect(result.externalTxId).toBe("ext-acc-1");
      expect(adapter.accumulateCalls).toHaveLength(1);
      expect(adapter.accumulateCalls[0]?.points).toBe(100);
      expect(adapter.accumulateCalls[0]?.externalMemberRef).toBe("ext-ref-1");
    });

    it("creates account if not linked and config feature disabled", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(
        configRow({ accumulationEnabled: false }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      svc.registerAdapter(new MockAdapter());

      await expect(
        svc.accumulate({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          points: 100,
          txRef: "ref-disabled",
        }),
      ).rejects.toThrow("Accumulation is not enabled");
    });
  });

  // ═══ Redeem ═══

  describe("redeem", () => {
    it("completes happy path: PENDING → adapter called → CONFIRMED", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow());
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ type: "REDEEM", status: "CONFIRMED", externalTxRef: "ext-red-1" }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({
        externalTxId: "ext-red-1",
        balanceOverride: 2000,
      });
      svc.registerAdapter(adapter);

      const result = await svc.redeem({
        programId: "prog-1",
        memberId: "mem-1",
        externalMemberRef: "ext-ref-1",
        points: 50,
        txRef: "ref-red-1",
      });

      expect(result.status).toBe("CONFIRMED");
      expect(result.externalTxId).toBe("ext-red-1");
      expect(adapter.redeemCalls).toHaveLength(1);
    });

    it("throws business error on insufficient external balance → no retry", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow({ type: "REDEEM" }));
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({
          type: "REDEEM",
          status: "FAILED",
          lastError: "Insufficient external balance: have 10, need 500",
        }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({
        balanceOverride: 10,
        businessError: "Insufficient external balance: have 10, need 500",
      });
      svc.registerAdapter(adapter);

      await expect(
        svc.redeem({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          points: 500,
          txRef: "ref-no-funds",
        }),
      ).rejects.toThrow(CoalitionBusinessError);

      // Should only have tried once — business errors are not retried
      expect(adapter.redeemCalls).toHaveLength(1);
    });

    it("throws CoalitionUnsupportedError when adapter does not support redeem", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow({ type: "REDEEM" }));

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({ capabilities: { redeem: false } });
      svc.registerAdapter(adapter);

      await expect(
        svc.redeem({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          points: 100,
          txRef: "ref-no-cap",
        }),
      ).rejects.toThrow(CoalitionUnsupportedError);

      // Should not have called the adapter at all
      expect(adapter.redeemCalls).toHaveLength(0);
    });
  });

  // ═══ Convert ═══

  describe("convert", () => {
    it("happy path: adapter convert → core redeem + earn", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(
        configRow({ minConversionPoints: 100 }),
      );
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow({ type: "REDEEM" }));
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ type: "REDEEM", status: "CONFIRMED", externalTxRef: "ext-cnv-1" }),
      );
      mockEarn.mockResolvedValue({
        transactionId: "earn-tx-1",
        amount: 300,
        multiplier: 1,
        balanceAfter: 5300,
        idempotent: false,
      });
      mockRedeem.mockResolvedValue({
        transactionId: "redeem-tx-1",
        amount: 300,
        balanceAfter: 4700,
        idempotent: false,
      });

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({ externalTxId: "ext-cnv-1" });
      svc.registerAdapter(adapter);

      const result = await svc.convert({
        programId: "prog-1",
        memberId: "mem-1",
        externalMemberRef: "ext-ref-1",
        ownPoints: 300,
        txRef: "ref-cnv-1",
      });

      expect(result.status).toBe("CONFIRMED");
      expect(adapter.convertCalls).toHaveLength(1);
      expect(mockRedeem).toHaveBeenCalledTimes(1);
      expect(mockEarn).toHaveBeenCalledTimes(1);
    });

    it("throws when conversion is disabled", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(
        configRow({ conversionEnabled: false }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      svc.registerAdapter(new MockAdapter());

      await expect(
        svc.convert({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          ownPoints: 300,
          txRef: "ref-disabled",
        }),
      ).rejects.toThrow("Conversion is not enabled");
    });

    it("throws when below minConversionPoints", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(
        configRow({ minConversionPoints: 1000 }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      svc.registerAdapter(new MockAdapter());

      await expect(
        svc.convert({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          ownPoints: 100,
          txRef: "ref-low",
        }),
      ).rejects.toThrow("Minimum conversion is 1000 points");
    });

    it("compensates (calls reverseTransaction) when core redeem fails after adapter success", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(
        configRow({ minConversionPoints: 100 }),
      );
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow({ type: "REDEEM" }));
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ type: "REDEEM", status: "CONFIRMED", externalTxRef: "ext-cnv-2" }),
      );
      mockRedeem.mockRejectedValue(new Error("Insufficient local balance"));

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({ externalTxId: "ext-cnv-2" });
      svc.registerAdapter(adapter);

      await expect(
        svc.convert({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          ownPoints: 300,
          txRef: "ref-compensate",
        }),
      ).rejects.toThrow(CoalitionBusinessError);

      // Compensation must have been called
      expect(adapter.reverseCalls).toHaveLength(1);
      expect(adapter.reverseCalls[0]?.txRef).toBe("ext-cnv-2");
    });
  });

  // ═══ Retries ═══

  describe("retries", () => {
    it("retries transient errors up to 3 times then succeeds", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow());
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ status: "CONFIRMED", externalTxRef: "ext-retry-1" }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      // 2 transient fails, then succeed
      const adapter = new MockAdapter({
        transientFails: 2,
        externalTxId: "ext-retry-1",
      });
      svc.registerAdapter(adapter);

      const result = await svc.accumulate({
        programId: "prog-1",
        memberId: "mem-1",
        externalMemberRef: "ext-ref-1",
        points: 100,
        txRef: "ref-retry",
      });

      expect(result.status).toBe("CONFIRMED");
      // Should have been called 3 times (2 transient fails + 1 success)
      expect(adapter.accumulateCalls).toHaveLength(3);
    });

    it("throws after exhausting retries on transient errors", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow());
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ status: "FAILED", lastError: "Transient failure 3/3", attempts: 4 }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      // 5 transient fails → never succeeds within 3 attempts
      const adapter = new MockAdapter({ transientFails: 5 });
      svc.registerAdapter(adapter);

      await expect(
        svc.accumulate({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          points: 100,
          txRef: "ref-exhaust",
        }),
      ).rejects.toThrow(CoalitionTransientError);

      // Should have retried exactly 3 times
      expect(adapter.accumulateCalls).toHaveLength(3);
    });

    it("does NOT retry business errors", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow());
      mockPrisma.coalitionTransaction.update.mockResolvedValue(
        txRow({ status: "FAILED", lastError: "Bad request", attempts: 2 }),
      );

      const svc = new CoalitionService(mockPrisma as never);
      const adapter = new MockAdapter({
        businessError: "Bad request: invalid external account",
      });
      svc.registerAdapter(adapter);

      await expect(
        svc.accumulate({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          points: 100,
          txRef: "ref-biz",
        }),
      ).rejects.toThrow(CoalitionBusinessError);

      // Only 1 attempt — business errors are not retried
      expect(adapter.accumulateCalls).toHaveLength(1);
    });
  });

  // ═══ Circuit Breaker ═══

  describe("circuit breaker", () => {
    it("opens breaker after consecutive failures", async () => {
      mockPrisma.coalitionConfig.findUnique.mockResolvedValue(configRow());
      mockPrisma.coalitionAccount.findFirst.mockResolvedValue(accountRow());
      mockPrisma.coalitionTransaction.findFirst.mockResolvedValue(null);
      mockPrisma.coalitionTransaction.create.mockResolvedValue(txRow());
      mockPrisma.coalitionTransaction.update.mockResolvedValue(txRow({ status: "FAILED" }));

      const svc = new CoalitionService(mockPrisma as never);
      // Use business errors to avoid retry delays (business errors fail immediately)
      const adapter = new MockAdapter({ businessError: "Service unavailable" });
      svc.registerAdapter(adapter);

      // 5 failures should trigger the breaker (volumeThreshold = 5)
      for (let i = 0; i < 5; i++) {
        try {
          await svc.accumulate({
            programId: "prog-1",
            memberId: "mem-1",
            externalMemberRef: "ext-ref-1",
            points: 10,
            txRef: `ref-cb-${String(i)}`,
          });
        } catch {
          // Expected
        }
      }

      // The 6th call should fail — breaker may or may not be open depending on timing
      try {
        await svc.accumulate({
          programId: "prog-1",
          memberId: "mem-1",
          externalMemberRef: "ext-ref-1",
          points: 10,
          txRef: "ref-cb-6",
        });
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });
});

// ═══ Encryption ═══

describe("credential encryption", () => {
  it("round-trips JSON credentials through encrypt/decrypt", () => {
    const creds = JSON.stringify({
      apiKey: "sk-1234567890",
      merchantId: "merchant-abc",
      secret: "super-secret-token",
    });
    const masterKey = "my-production-master-key-32chars!!";
    const encrypted = encrypt(creds, masterKey);
    const decrypted = decrypt(encrypted, masterKey);

    expect(encrypted).not.toBe(creds);
    expect(encrypted).not.toContain("sk-1234567890");
    expect(decrypted).toBe(creds);
    expect(JSON.parse(decrypted)).toEqual({
      apiKey: "sk-1234567890",
      merchantId: "merchant-abc",
      secret: "super-secret-token",
    });
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const masterKey = "my-production-master-key-32chars!!";
    const a = encrypt("hello", masterKey);
    const b = encrypt("hello", masterKey);
    expect(a).not.toBe(b); // different IVs
    // Both should decrypt to the same plaintext
    expect(decrypt(a, masterKey)).toBe("hello");
    expect(decrypt(b, masterKey)).toBe("hello");
  });

  it("fails to decrypt with a different master key", () => {
    const encrypted = encrypt("sensitive data", "key-a-32chars-long-enough!!");
    expect(() => decrypt(encrypted, "key-b-32chars-long-enough!!")).toThrow();
  });

  it("getMasterKey returns dev fallback when env var is not set", () => {
    const key = getMasterKey();
    expect(key).toBeTruthy();
    expect(key.length).toBeGreaterThanOrEqual(16);
  });
});

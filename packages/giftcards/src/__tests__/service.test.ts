import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock code.ts ──────────────────────────────────

const mockGenerateCode = vi.fn().mockReturnValue("ABCDEFGHJKLMNPQR");
const mockValidateChecksum = vi.fn().mockReturnValue(true);
const mockNormalizeCode = vi.fn((s: string) => s.toUpperCase().replace(/[\s-]/g, ""));

vi.mock("../code.js", () => ({
  generateCode: (...args: unknown[]) => mockGenerateCode(...args),
  validateChecksum: (...args: unknown[]) => mockValidateChecksum(...args),
  normalizeCode: (s: string) => mockNormalizeCode(s),
  formatCode: (s: string) => (s.length >= 4 ? s.replace(/(.{4})/g, "$1-").replace(/-$/, "") : s),
  ALPHABET: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
}));

// ── Mock Prisma ───────────────────────────────────

const mockPrisma = {
  giftCardBatch: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  giftCard: {
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  giftCardTransaction: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  termsTemplate: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
};

let GiftCardService: typeof import("../service.js").GiftCardService;

beforeEach(async () => {
  vi.resetAllMocks();
  mockValidateChecksum.mockReturnValue(true);
  mockGenerateCode.mockReturnValue("ABCDEFGHJKLMNPQR");
  const mod = await import("../service.js");
  GiftCardService = mod.GiftCardService;
});

// ── Helpers ───────────────────────────────────────

function batchRow(overrides = {}) {
  return {
    id: "batch-1",
    programId: "prog-1",
    name: "Test Batch",
    quantity: 10,
    initialAmount: 1000 as unknown as number, // Decimal
    currency: "MXN",
    prefix: null,
    expirationDate: new Date("2026-12-31"),
    termsTemplateId: "terms-1",
    status: "pending" as const,
    generationJobId: null,
    generatedCount: 0,
    createdById: "admin-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function cardRow(overrides = {}) {
  return {
    id: "card-1",
    code: "ABCDEFGHJKLMNPQR",
    batchId: "batch-1",
    initialAmount: 1000 as unknown as number,
    balance: 800 as unknown as number,
    currency: "MXN",
    expirationDate: new Date("2026-12-31"),
    status: "active" as const,
    activatedAt: new Date(),
    lastRedemptionAt: new Date(),
    metadata: null,
    batch: { programId: "prog-1" },
    ...overrides,
  };
}

function transactionRow(overrides = {}) {
  return {
    id: "tx-1",
    giftCardId: "card-1",
    type: "redeem" as const,
    amount: 200 as unknown as number,
    balanceAfter: 800 as unknown as number,
    memberId: null,
    idempotencyKey: null,
    orderRef: null,
    createdById: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function termsRow(overrides = {}) {
  return {
    id: "terms-1",
    programId: "prog-1",
    name: "Standard Terms",
    locale: "es-MX",
    body: "Terms and conditions body text.",
    version: 1,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Batch management ──────────────────────────────

describe("GiftCardService.createBatch", () => {
  it("creates a batch and enqueues generation", async () => {
    mockPrisma.giftCardBatch.create.mockResolvedValue(batchRow());

    let enqueuedJobName = "";
    let enqueuedData: Record<string, unknown> = {};
    const svc = new GiftCardService(mockPrisma as never);
    svc.setEnqueueGenerate((jobName, data) => {
      enqueuedJobName = jobName;
      enqueuedData = data;
      return Promise.resolve();
    });

    const result = await svc.createBatch({
      programId: "prog-1",
      name: "Test Batch",
      quantity: 10,
      initialAmount: 1000,
      currency: "MXN",
      expirationDate: new Date("2026-12-31"),
      termsTemplateId: "terms-1",
      createdById: "admin-1",
    });

    expect(result.id).toBe("batch-1");
    expect(enqueuedJobName).toBe("generate");
    expect(enqueuedData).toEqual({ batchId: "batch-1" });
  });
});

describe("GiftCardService.getBatch", () => {
  it("returns a batch by id", async () => {
    mockPrisma.giftCardBatch.findUnique.mockResolvedValue(batchRow());

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.getBatch("batch-1");

    expect(result.id).toBe("batch-1");
  });

  it("throws GiftCardBatchNotFoundError for missing batch", async () => {
    mockPrisma.giftCardBatch.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.getBatch("nonexistent")).rejects.toThrow("not found");
  });
});

describe("GiftCardService.listBatches", () => {
  it("returns paginated list", async () => {
    mockPrisma.giftCardBatch.findMany.mockResolvedValue([batchRow()]);
    mockPrisma.giftCardBatch.count.mockResolvedValue(1);

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.listBatches("prog-1", {});

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe("GiftCardService.cancelBatch", () => {
  it("cancels a pending batch", async () => {
    mockPrisma.giftCardBatch.findUnique.mockResolvedValue(batchRow({ status: "pending" }));
    mockPrisma.giftCardBatch.update.mockResolvedValue(batchRow({ status: "cancelled" }));

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.cancelBatch("batch-1");

    expect(result.status).toBe("cancelled");
  });

  it("throws GiftCardBatchNotFoundError for missing batch", async () => {
    mockPrisma.giftCardBatch.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.cancelBatch("nonexistent")).rejects.toThrow("not found");
  });

  it("throws when batch is already ready", async () => {
    mockPrisma.giftCardBatch.findUnique.mockResolvedValue(batchRow({ status: "ready" }));

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.cancelBatch("batch-1")).rejects.toThrow("Cannot cancel");
  });
});

// ── Code validation ───────────────────────────────

describe("GiftCardService.validateCode", () => {
  it("returns valid for an active card", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(cardRow());

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.validateCode({ code: "ABCD-EFGH-JKLM-NPQR" });

    expect(result.valid).toBe(true);
    expect(result.balance).toBe(800);
    expect(result.currency).toBe("MXN");
    expect(result.status).toBe("active");
  });

  it("returns invalid for a code that fails checksum", async () => {
    mockValidateChecksum.mockReturnValue(false);

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.validateCode({ code: "BOGUS-CODE-HERE-XYZ" });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_code");
    expect(mockPrisma.giftCard.findUnique).not.toHaveBeenCalled();
  });

  it("returns invalid for a code not in database", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.validateCode({ code: "ABCDEFGHJKLMNPQR" });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("returns invalid for an expired card", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(
      cardRow({ expirationDate: new Date("2020-01-01") }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.validateCode({ code: "ABCDEFGHJKLMNPQR" });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("returns invalid for a cancelled card", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(cardRow({ status: "cancelled" }));

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.validateCode({ code: "ABCDEFGHJKLMNPQR" });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("cancelled");
  });

  it("returns invalid for a depleted card", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(cardRow({ status: "depleted" }));

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.validateCode({ code: "ABCDEFGHJKLMNPQR" });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("depleted");
  });
});

// ── Redemption ────────────────────────────────────

describe("GiftCardService.redeem", () => {
  const mockLockFn = () => Promise.resolve({ acquired: true, release: () => Promise.resolve() });

  it("redeems amount and returns new balance", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null); // no idempotency
    mockPrisma.giftCard.findUnique.mockResolvedValue(cardRow());
    mockPrisma.giftCard.update.mockResolvedValue(
      cardRow({ balance: 600 as unknown as number, status: "partially_redeemed" }),
    );
    mockPrisma.giftCardTransaction.create.mockResolvedValue(
      transactionRow({ amount: 200 as unknown as number, balanceAfter: 600 as unknown as number }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.redeem(
      { code: "ABCDEFGHJKLMNPQR", amount: 200, idempotencyKey: "idem-1" },
      mockLockFn,
    );

    expect(result.amount).toBe(200);
    expect(result.balanceAfter).toBe(600);
    expect(result.idempotent).toBe(false);
  });

  it("returns cached result for duplicate idempotency key", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(
      transactionRow({ id: "tx-existing", idempotencyKey: "idem-1" }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.redeem(
      { code: "ABCDEFGHJKLMNPQR", amount: 200, idempotencyKey: "idem-1" },
      mockLockFn,
    );

    expect(result.idempotent).toBe(true);
    expect(result.transactionId).toBe("tx-existing");
  });

  it("throws GiftCardInvalidCodeError for invalid checksum", async () => {
    mockValidateChecksum.mockReturnValue(false);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(
      svc.redeem({ code: "BOGUS", amount: 100, idempotencyKey: "idem-1" }, mockLockFn),
    ).rejects.toThrow("invalid");
  });

  it("throws GiftCardNotFoundError for missing card", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.giftCard.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(
      svc.redeem({ code: "ABCDEFGHJKLMNPQR", amount: 100, idempotencyKey: "idem-1" }, mockLockFn),
    ).rejects.toThrow("not found");
  });

  it("throws GiftCardInsufficientBalanceError when balance too low", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.giftCard.findUnique.mockResolvedValue(cardRow({ balance: 50 as unknown as number }));

    const svc = new GiftCardService(mockPrisma as never);
    await expect(
      svc.redeem({ code: "ABCDEFGHJKLMNPQR", amount: 100, idempotencyKey: "idem-1" }, mockLockFn),
    ).rejects.toThrow("insufficient balance");
  });

  it("sets status to depleted when balance reaches zero", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.giftCard.findUnique.mockResolvedValue(
      cardRow({ balance: 200 as unknown as number }),
    );
    mockPrisma.giftCard.update.mockResolvedValue(
      cardRow({ balance: 0 as unknown as number, status: "depleted" }),
    );
    mockPrisma.giftCardTransaction.create.mockResolvedValue(
      transactionRow({ amount: 200 as unknown as number, balanceAfter: 0 as unknown as number }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.redeem(
      { code: "ABCDEFGHJKLMNPQR", amount: 200, idempotencyKey: "idem-1" },
      mockLockFn,
    );

    expect(result.balanceAfter).toBe(0);
  });

  it("throws GiftCardLockError when lock not acquired", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(
      svc.redeem({ code: "ABCDEFGHJKLMNPQR", amount: 100, idempotencyKey: "idem-1" }, () =>
        Promise.resolve({ acquired: false, release: () => Promise.resolve() }),
      ),
    ).rejects.toThrow("currently being processed");
  });
});

// ── Refund ────────────────────────────────────────

describe("GiftCardService.refund", () => {
  it("refunds amount and updates balance", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.giftCard.findUnique.mockResolvedValue(
      cardRow({ balance: 600 as unknown as number }),
    );
    mockPrisma.giftCard.update.mockResolvedValue(
      cardRow({ balance: 800 as unknown as number, status: "partially_redeemed" }),
    );
    mockPrisma.giftCardTransaction.create.mockResolvedValue(
      transactionRow({
        type: "refund",
        amount: 200 as unknown as number,
        balanceAfter: 800 as unknown as number,
      }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.refund({
      code: "ABCDEFGHJKLMNPQR",
      amount: 200,
      idempotencyKey: "idem-2",
    });

    expect(result.amount).toBe(200);
    expect(result.balanceAfter).toBe(800);
  });

  it("restores status to active when fully refunded", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(null);
    mockPrisma.giftCard.findUnique.mockResolvedValue(
      cardRow({ balance: 600 as unknown as number, initialAmount: 1000 as unknown as number }),
    );
    mockPrisma.giftCard.update.mockResolvedValue(
      cardRow({ balance: 1000 as unknown as number, status: "active" }),
    );
    mockPrisma.giftCardTransaction.create.mockResolvedValue(
      transactionRow({
        type: "refund",
        amount: 400 as unknown as number,
        balanceAfter: 1000 as unknown as number,
      }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.refund({
      code: "ABCDEFGHJKLMNPQR",
      amount: 400,
      idempotencyKey: "idem-3",
    });

    expect(result.balanceAfter).toBe(1000);
  });

  it("returns cached result for duplicate idempotency key", async () => {
    mockPrisma.giftCardTransaction.findUnique.mockResolvedValue(
      transactionRow({ idempotencyKey: "idem-2", type: "refund" }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.refund({
      code: "ABCDEFGHJKLMNPQR",
      amount: 200,
      idempotencyKey: "idem-2",
    });

    expect(result.idempotent).toBe(true);
  });
});

// ── Cancel card ───────────────────────────────────

describe("GiftCardService.cancelCard", () => {
  it("cancels a card and records transaction", async () => {
    mockPrisma.giftCard.findUnique
      .mockResolvedValueOnce(cardRow({ balance: 500 as unknown as number })) // first lookup
      .mockResolvedValueOnce(cardRow({ balance: 0 as unknown as number, status: "cancelled" })); // return after cancel
    mockPrisma.giftCard.update.mockResolvedValue(
      cardRow({ balance: 0 as unknown as number, status: "cancelled" }),
    );
    mockPrisma.giftCardTransaction.create.mockResolvedValue(
      transactionRow({ type: "cancel", amount: 500 as unknown as number }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.cancelCard({ code: "ABCDEFGHJKLMNPQR" });

    expect(result?.status).toBe("cancelled");
  });

  it("throws GiftCardNotFoundError for missing card", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.cancelCard({ code: "BOGUS" })).rejects.toThrow("not found");
  });

  it("throws GiftCardCancelledError if already cancelled", async () => {
    mockPrisma.giftCard.findUnique.mockResolvedValue(cardRow({ status: "cancelled" }));

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.cancelCard({ code: "ABCDEFGHJKLMNPQR" })).rejects.toThrow("cancelled");
  });
});

// ── Expiration processing ─────────────────────────

describe("GiftCardService.processExpiredCards", () => {
  it("marks expired cards and writes transactions", async () => {
    mockPrisma.giftCard.findMany.mockResolvedValue([
      cardRow({ id: "card-1", balance: 100 as unknown as number }),
      cardRow({ id: "card-2", balance: 200 as unknown as number }),
    ]);
    mockPrisma.giftCard.update.mockResolvedValue(cardRow({ status: "expired" }));
    mockPrisma.giftCardTransaction.create.mockResolvedValue(transactionRow({ type: "expire" }));

    const svc = new GiftCardService(mockPrisma as never);
    const count = await svc.processExpiredCards();

    expect(count).toBe(2);
    expect(mockPrisma.giftCard.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.giftCardTransaction.create).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when no cards to expire", async () => {
    mockPrisma.giftCard.findMany.mockResolvedValue([]);

    const svc = new GiftCardService(mockPrisma as never);
    const count = await svc.processExpiredCards();

    expect(count).toBe(0);
  });
});

// ── Transactions ──────────────────────────────────

describe("GiftCardService.getTransactions", () => {
  it("returns paginated transactions", async () => {
    mockPrisma.giftCardTransaction.findMany.mockResolvedValue([transactionRow()]);
    mockPrisma.giftCardTransaction.count.mockResolvedValue(1);

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.getTransactions("card-1", {});

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

// ── Terms templates ───────────────────────────────

describe("GiftCardService.createTermsTemplate", () => {
  it("creates a terms template", async () => {
    mockPrisma.termsTemplate.create.mockResolvedValue(termsRow());

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.createTermsTemplate({
      programId: "prog-1",
      name: "Standard Terms",
      body: "Terms and conditions body text.",
    });

    expect(result.name).toBe("Standard Terms");
    expect(result.version).toBe(1);
  });
});

describe("GiftCardService.getTermsTemplate", () => {
  it("returns a template by id", async () => {
    mockPrisma.termsTemplate.findUnique.mockResolvedValue(termsRow());

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.getTermsTemplate("terms-1");

    expect(result.id).toBe("terms-1");
  });

  it("throws TermsTemplateNotFoundError for missing template", async () => {
    mockPrisma.termsTemplate.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.getTermsTemplate("nonexistent")).rejects.toThrow("not found");
  });
});

describe("GiftCardService.listTermsTemplates", () => {
  it("returns list of templates", async () => {
    mockPrisma.termsTemplate.findMany.mockResolvedValue([termsRow()]);

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.listTermsTemplates("prog-1");

    expect(result).toHaveLength(1);
  });
});

describe("GiftCardService.updateTermsTemplate", () => {
  it("creates a new version row", async () => {
    mockPrisma.termsTemplate.findUnique.mockResolvedValue(termsRow());
    mockPrisma.termsTemplate.create.mockResolvedValue(
      termsRow({ id: "terms-2", body: "Updated body text.", version: 2 }),
    );

    const svc = new GiftCardService(mockPrisma as never);
    const result = await svc.updateTermsTemplate("terms-1", { body: "Updated body text." });

    expect(mockPrisma.termsTemplate.create).toHaveBeenCalled();
    expect(result.version).toBe(2);
  });

  it("throws TermsTemplateNotFoundError for missing template", async () => {
    mockPrisma.termsTemplate.findUnique.mockResolvedValue(null);

    const svc = new GiftCardService(mockPrisma as never);
    await expect(svc.updateTermsTemplate("nonexistent", { body: "New body" })).rejects.toThrow(
      "not found",
    );
  });
});

describe("GiftCardService.deleteTermsTemplate", () => {
  it("soft-deletes a terms template", async () => {
    mockPrisma.termsTemplate.findUnique.mockResolvedValue(termsRow());

    const svc = new GiftCardService(mockPrisma as never);
    await svc.deleteTermsTemplate("terms-1");

    expect(mockPrisma.termsTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "terms-1" },
        data: { isActive: false },
      }),
    );
  });
});

import type { PointTransaction, TransactionType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { applyTxToBalance, verifyConsistency } from "../ledger.js";

const makeTx = (overrides: Partial<PointTransaction> = {}): PointTransaction =>
  ({
    id: "tx-1",
    accountId: "acc-1",
    type: "EARN" as TransactionType,
    amount: 100,
    balanceAfter: 100,
    source: "test",
    idempotencyKey: "ik-1",
    createdAt: new Date(),
    description: null,
    metadata: null,
    expiresAt: null,
    settledAt: null,
    reversedFromId: null,
    reversedById: null,
    ...overrides,
  }) as PointTransaction;

describe("applyTxToBalance", () => {
  it("EARN increases balance", () => {
    expect(applyTxToBalance("EARN", 100)).toBe(100);
  });

  it("REDEEM decreases balance", () => {
    expect(applyTxToBalance("REDEEM", 50)).toBe(-50);
  });

  it("REVERSE decreases balance", () => {
    expect(applyTxToBalance("REVERSE", 200)).toBe(-200);
  });

  it("EXPIRE decreases balance", () => {
    expect(applyTxToBalance("EXPIRE", 30)).toBe(-30);
  });

  it("ADJUST increases balance (positive amount)", () => {
    expect(applyTxToBalance("ADJUST", 150)).toBe(150);
  });

  it("ADJUST decreases balance (negative amount) is still positive delta", () => {
    // ADJUST of +50 means we add 50 to balance
    expect(applyTxToBalance("ADJUST", 50)).toBe(50);
  });

  it("CONVERT_OUT decreases balance", () => {
    expect(applyTxToBalance("CONVERT_OUT", 1000)).toBe(-1000);
  });

  it("CONVERT_IN increases balance", () => {
    expect(applyTxToBalance("CONVERT_IN", 500)).toBe(500);
  });
});

describe("verifyConsistency", () => {
  it("passes for valid transaction chain", () => {
    const txs = [
      makeTx({ id: "t1", type: "EARN", amount: 100, balanceAfter: 100 }),
      makeTx({ id: "t2", type: "EARN", amount: 50, balanceAfter: 150 }),
      makeTx({ id: "t3", type: "REDEEM", amount: 30, balanceAfter: 120 }),
    ];
    const result = verifyConsistency(txs);
    expect(result.valid).toBe(true);
    expect(result.finalBalance).toBe(120);
  });

  it("detects balance mismatch", () => {
    const txs = [
      makeTx({ id: "t1", type: "EARN", amount: 100, balanceAfter: 100 }),
      makeTx({ id: "t2", type: "EARN", amount: 50, balanceAfter: 200 }), // wrong
    ];
    const result = verifyConsistency(txs);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
  });
});

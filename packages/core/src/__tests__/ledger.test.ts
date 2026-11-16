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

const settled = (overrides: Partial<PointTransaction> = {}) =>
  makeTx({ settledAt: new Date(), ...overrides });

describe("verifyConsistency", () => {
  it("passes for a valid confirmed chain", () => {
    const txs = [
      settled({ id: "t1", type: "EARN", amount: 100 }),
      settled({ id: "t2", type: "EARN", amount: 50 }),
      settled({ id: "t3", type: "REDEEM", amount: 30 }),
    ];
    const result = verifyConsistency({ transactions: txs, balance: 120, pendingBalance: 0 });
    expect(result.valid).toBe(true);
    expect(result.confirmedBalance).toBe(120);
    expect(result.confirmedDifference).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("keeps held EARNs out of the confirmed balance", () => {
    const txs = [makeTx({ id: "t1", type: "EARN", amount: 100, settledAt: null })];
    const result = verifyConsistency({ transactions: txs, balance: 0, pendingBalance: 100 });
    expect(result.valid).toBe(true);
    expect(result.confirmedBalance).toBe(0);
    expect(result.pendingBalance).toBe(100);
  });

  it("reports the confirmed difference when balance is tampered with", () => {
    const txs = [settled({ id: "t1", type: "EARN", amount: 100 })];
    const result = verifyConsistency({ transactions: txs, balance: 90, pendingBalance: 0 });
    expect(result.valid).toBe(false);
    expect(result.confirmedDifference).toBe(10);
    expect(result.pendingDifference).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it("reports the pending difference when pendingBalance is tampered with", () => {
    const txs = [makeTx({ id: "t1", type: "EARN", amount: 100, settledAt: null })];
    const result = verifyConsistency({ transactions: txs, balance: 0, pendingBalance: 90 });
    expect(result.valid).toBe(false);
    expect(result.confirmedDifference).toBe(0);
    expect(result.pendingDifference).toBe(10);
    expect(result.errors).toHaveLength(1);
  });

  it("reports confirmed and pending differences separately", () => {
    const txs = [
      settled({ id: "t1", type: "EARN", amount: 100 }),
      makeTx({ id: "t2", type: "EARN", amount: 50, settledAt: null }),
    ];
    const result = verifyConsistency({ transactions: txs, balance: 90, pendingBalance: 40 });
    expect(result.valid).toBe(false);
    expect(result.confirmedDifference).toBe(10);
    expect(result.pendingDifference).toBe(10);
    expect(result.errors).toHaveLength(2);
  });
});

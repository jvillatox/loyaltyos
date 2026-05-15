import type { PointTransaction, TransactionType } from "@prisma/client";

/**
 * Ledger verification helpers. The ledger is immutable — rows are never deleted.
 * These functions operate on PointTransaction records already persisted.
 */

export function verifyConsistency(transactions: PointTransaction[]): {
  valid: boolean;
  finalBalance: number;
  errors: string[];
} {
  let runningBalance = 0;
  const errors: string[] = [];

  for (const tx of transactions) {
    const expected = applyTxToBalance(tx.type, tx.amount);
    runningBalance += expected;
    if (runningBalance !== tx.balanceAfter) {
      errors.push(
        `Tx ${tx.id}: expected balanceAfter=${String(runningBalance)} but got ${String(tx.balanceAfter)}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    finalBalance: runningBalance,
    errors,
  };
}

export function applyTxToBalance(type: TransactionType, amount: number): number {
  switch (type) {
    case "EARN":
    case "CONVERT_IN":
    case "ADJUST":
      return amount;
    case "REDEEM":
    case "EXPIRE":
    case "REVERSE":
    case "CONVERT_OUT":
      return -amount;
    default:
      return 0;
  }
}

export function validateNoDoubleReversal(
  transactions: PointTransaction[],
  targetTxId: string,
): boolean {
  const alreadyReversed = transactions.some((tx) => tx.reversedFromId === targetTxId);
  return !alreadyReversed;
}

import type { PointTransaction, TransactionType } from "@prisma/client";

/**
 * Ledger verification helpers. The ledger is immutable — rows are never deleted.
 * These functions operate on PointTransaction records already persisted.
 */

export interface LedgerConsistencyResult {
  valid: boolean;
  /** Confirmed (spendable) balance as derived from the ledger. */
  confirmedBalance: number;
  /** Pending (held) balance as derived from the ledger. */
  pendingBalance: number;
  /** Ledger-confirmed balance minus the account's actual `balance`. */
  confirmedDifference: number;
  /** Ledger-pending balance minus the account's actual `pendingBalance`. */
  pendingDifference: number;
  errors: string[];
}

/**
 * Verifies that a point account's ledger matches its stored balances.
 *
 * Held EARNs (and reversals of held EARNs) are written with `settledAt = null`
 * and affect `pendingBalance`; settlement writes no ledger entry, it only flips
 * `settledAt` to a timestamp. So the confirmed balance is compared against the
 * transactions with `settledAt != null` (settled EARNs, REDEEM, ADJUST, REVERSE,
 * EXPIRE) and the pending balance against the still-unsettled transactions,
 * instead of replaying `balanceAfter` across every row.
 */
export function verifyConsistency(input: {
  transactions: PointTransaction[];
  balance: number;
  pendingBalance: number;
}): LedgerConsistencyResult {
  const { transactions, balance, pendingBalance } = input;

  let confirmed = 0;
  let pending = 0;

  for (const tx of transactions) {
    const effect = applyTxToBalance(tx.type, tx.amount);
    if (tx.settledAt === null) {
      pending += effect;
    } else {
      confirmed += effect;
    }
  }

  const confirmedDifference = confirmed - balance;
  const pendingDifference = pending - pendingBalance;
  const errors: string[] = [];

  if (confirmedDifference !== 0) {
    errors.push(
      `Confirmed balance mismatch: ledger=${String(confirmed)} account=${String(balance)} difference=${String(confirmedDifference)}`,
    );
  }
  if (pendingDifference !== 0) {
    errors.push(
      `Pending balance mismatch: ledger=${String(pending)} account=${String(pendingBalance)} difference=${String(pendingDifference)}`,
    );
  }

  return {
    valid: errors.length === 0,
    confirmedBalance: confirmed,
    pendingBalance: pending,
    confirmedDifference,
    pendingDifference,
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

import type { Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import { audit } from "./audit.js";

export const ADJUSTMENT_REASON_CATEGORIES = [
  "CUSTOMER_SERVICE",
  "ERROR_CORRECTION",
  "PROMOTION",
  "FRAUD",
  "OTHER",
] as const;

export type AdjustmentReasonCategory = (typeof ADJUSTMENT_REASON_CATEGORIES)[number];

/** PENDING requests that stay undecided this long are marked EXPIRED. */
export const ADJUSTMENT_EXPIRY_DAYS = 7;

export interface AdjustmentLimits {
  operatorPerTx: number;
  operatorDaily: number;
  serverPerTx: number;
}

export function adjustmentLimits(program: {
  adjustOperatorPerTxLimit: number;
  adjustOperatorDailyLimit: number;
  adjustServerPerTxLimit: number;
}): AdjustmentLimits {
  return {
    operatorPerTx: program.adjustOperatorPerTxLimit,
    operatorDaily: program.adjustOperatorDailyLimit,
    serverPerTx: program.adjustServerPerTxLimit,
  };
}

export type AdjustmentRequester =
  | { type: "ADMIN_USER"; id: string; role: "SUPER_ADMIN" | "OPERATOR" }
  | { type: "API_KEY"; id: string };

export type AdjustmentDecision = "DIRECT" | "PENDING" | "REJECT";

/**
 * Decide how a manual adjustment should be handled.
 *
 * - SERVER key: per-transaction cap only; over the cap is a hard 422 (REJECT),
 *   never pending.
 * - SUPER_ADMIN: always applied directly, no caps.
 * - OPERATOR: per-transaction cap and daily cap (both on absolute value). Over
 *   either → PENDING for a SUPER_ADMIN to approve.
 */
export function decideAdjustment(
  requester: AdjustmentRequester,
  amount: number,
  limits: AdjustmentLimits,
  dailyTotal: number,
): AdjustmentDecision {
  const abs = Math.abs(amount);

  if (requester.type === "API_KEY") {
    return abs <= limits.serverPerTx ? "DIRECT" : "REJECT";
  }

  if (requester.role === "SUPER_ADMIN") {
    return "DIRECT";
  }

  if (abs > limits.operatorPerTx) return "PENDING";
  if (dailyTotal + abs > limits.operatorDaily) return "PENDING";
  return "DIRECT";
}

function startOfTodayUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Absolute total of an operator's directly-applied (self-approved) adjustments
 * today. Requests that were PENDING and later approved by a SUPER_ADMIN have
 * `decidedById` set, so they do not count against the operator's autonomous
 * daily spend — that spend is already gated by the approver.
 */
export async function directAdjustmentTotalToday(
  db: Prisma.TransactionClient,
  programId: string,
  adminId: string,
  now: Date,
): Promise<number> {
  const rows = await db.pointAdjustmentRequest.findMany({
    where: {
      programId,
      requestedById: adminId,
      requestedByType: "ADMIN_USER",
      status: "APPROVED",
      decidedById: null,
      createdAt: { gte: startOfTodayUtc(now) },
    },
    select: { amount: true },
  });
  return rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
}

/**
 * Serializes concurrent adjustments from the same (program, actor) so the daily
 * limit check cannot be raced. The lock is released when the surrounding
 * transaction commits or rolls back.
 */
export async function acquireAdjustmentLock(
  db: Prisma.TransactionClient,
  programId: string,
  actorKey: string,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${programId}), hashtext(${actorKey}))`;
}

export function composeLedgerReason(category: AdjustmentReasonCategory, comment: string): string {
  return comment ? `${category}: ${comment}` : category;
}

/**
 * Deterministic ledger idempotency key for the points applied by a request.
 * The client's Idempotency-Key only identifies the request; the ledger key is
 * derived from the request id so it can never collide with a key an unrelated
 * event or adjustment already used.
 */
export function ledgerIdempotencyKey(requestId: string): string {
  return `adjust:${requestId}`;
}

/** Marks overdue PENDING requests EXPIRED (worker job). Returns the count. */
export async function expirePendingAdjustments(now = new Date()): Promise<number> {
  const due = await prisma.pointAdjustmentRequest.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    select: {
      id: true,
      programId: true,
      amount: true,
      reasonCategory: true,
      comment: true,
    },
  });

  let expired = 0;
  for (const request of due) {
    const claimed = await prisma.pointAdjustmentRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "EXPIRED", decidedAt: now },
    });
    if (claimed.count === 0) continue;

    await audit(
      request.programId,
      { type: "SYSTEM", id: "system" },
      "OTHER",
      "point_adjustment_request",
      request.id,
      {
        action: "adjust.expire",
        amount: request.amount,
        reasonCategory: request.reasonCategory,
        comment: request.comment,
      },
    );
    expired++;
  }
  return expired;
}

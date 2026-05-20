import type { Prisma, TransactionType } from "@prisma/client";

// ── CoalitionAdapter Interface ──────────────────────────────────

export interface CoalitionAdapter {
  name: string;
  healthcheck(): Promise<{ ok: boolean; latencyMs?: number; details?: unknown }>;
  getBalance(externalMemberRef: string): Promise<number>;
  accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult>;
  redeem(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult>;
  convert(externalMemberRef: string, ownPoints: number, txRef: string): Promise<TxResult>;
  reverseTransaction(txRef: string, reason: string): Promise<void>;
}

export interface TxResult {
  externalTxId: string;
  balanceAfter?: number;
  raw?: unknown;
}

// ── Error Classification ───────────────────────────────────────

export class CoalitionTransientError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "CoalitionTransientError";
    this.statusCode = statusCode;
  }
}

export class CoalitionBusinessError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "CoalitionBusinessError";
    this.statusCode = statusCode;
  }
}

export class CoalitionCircuitOpenError extends Error {
  constructor(adapter: string) {
    super(`Circuit breaker open for adapter "${adapter}"`);
    this.name = "CoalitionCircuitOpenError";
  }
}

export class CoalitionConfigNotFoundError extends Error {
  constructor(programId: string) {
    super(`No coalition config found for program "${programId}"`);
    this.name = "CoalitionConfigNotFoundError";
  }
}

export class CoalitionAccountNotLinkedError extends Error {
  constructor(memberId: string, programId: string) {
    super(`No coalition account linked for member "${memberId}" in program "${programId}"`);
    this.name = "CoalitionAccountNotLinkedError";
  }
}

// ── Service Input / Output ─────────────────────────────────────

export interface AccumulateInput {
  programId: string;
  memberId: string;
  externalMemberRef: string;
  points: number;
  txRef: string;
  metadata?: object;
}

export interface RedeemInput {
  programId: string;
  memberId: string;
  externalMemberRef: string;
  points: number;
  txRef: string;
  metadata?: object;
}

export interface ConvertInput {
  programId: string;
  memberId: string;
  externalMemberRef: string;
  ownPoints: number;
  txRef: string;
}

export interface CoalitionOperationResult {
  txId: string;
  externalTxId?: string;
  status: string;
  balanceAfter?: number;
  idempotent: boolean;
}

// ── Row Types ──────────────────────────────────────────────────

export interface CoalitionConfigRow {
  id: string;
  programId: string;
  provider: string;
  endpoint: string;
  encryptedCredentials: string;
  conversionRate: number;
  accumulationEnabled: boolean;
  redemptionEnabled: boolean;
  conversionEnabled: boolean;
  minConversionPoints: number;
  circuitState: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoalitionAccountRow {
  id: string;
  memberId: string;
  programId: string;
  provider: string;
  externalId: string;
  externalBalance: number;
  lastSyncedAt: Date | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoalitionTransactionRow {
  id: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  localTxRef: string;
  externalTxRef: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  metadata: Prisma.JsonValue | null;
  idempotencyKey: string;
  createdAt: Date;
}

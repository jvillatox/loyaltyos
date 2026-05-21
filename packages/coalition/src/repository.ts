import { Prisma, PrismaClient } from "@prisma/client";

import type { CoalitionAccountRow, CoalitionConfigRow, CoalitionTransactionRow } from "./types.js";

export function createRepository(prisma: PrismaClient) {
  // ── CoalitionConfig ───────────────────────────────────────────

  async function getConfig(programId: string): Promise<CoalitionConfigRow | null> {
    return prisma.coalitionConfig.findUnique({ where: { programId } });
  }

  async function upsertConfig(input: {
    programId: string;
    provider?: string;
    endpoint: string;
    encryptedCredentials: string;
    conversionRate?: number;
    accumulationEnabled?: boolean;
    redemptionEnabled?: boolean;
    conversionEnabled?: boolean;
    minConversionPoints?: number;
  }): Promise<CoalitionConfigRow> {
    return prisma.coalitionConfig.upsert({
      where: { programId: input.programId },
      create: {
        programId: input.programId,
        provider: input.provider ?? "GENERIC",
        endpoint: input.endpoint,
        encryptedCredentials: input.encryptedCredentials,
        conversionRate: input.conversionRate ?? 1.0,
        accumulationEnabled: input.accumulationEnabled ?? false,
        redemptionEnabled: input.redemptionEnabled ?? false,
        conversionEnabled: input.conversionEnabled ?? false,
        minConversionPoints: input.minConversionPoints ?? 500,
      },
      update: {
        provider: input.provider,
        endpoint: input.endpoint,
        encryptedCredentials: input.encryptedCredentials,
        conversionRate: input.conversionRate,
        accumulationEnabled: input.accumulationEnabled,
        redemptionEnabled: input.redemptionEnabled,
        conversionEnabled: input.conversionEnabled,
        minConversionPoints: input.minConversionPoints,
      },
    });
  }

  async function updateCircuitState(
    configId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    await prisma.coalitionConfig.update({
      where: { id: configId },
      data: { circuitState: state as Prisma.InputJsonValue },
    });
  }

  // ── CoalitionAccount ──────────────────────────────────────────

  async function getAccount(
    memberId: string,
    programId: string,
  ): Promise<CoalitionAccountRow | null> {
    return prisma.coalitionAccount.findFirst({
      where: { memberId, programId },
    });
  }

  async function getAccountById(id: string): Promise<CoalitionAccountRow | null> {
    return prisma.coalitionAccount.findUnique({
      where: { id },
    });
  }

  async function getAccountByExternalRef(
    provider: string,
    externalId: string,
  ): Promise<CoalitionAccountRow | null> {
    return prisma.coalitionAccount.findUnique({
      where: { provider_externalId: { provider, externalId } },
    });
  }

  async function listAccounts(
    programId: string,
    opts?: { search?: string; page?: number; pageSize?: number },
  ): Promise<CoalitionAccountRow[]> {
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 20;
    return prisma.coalitionAccount.findMany({
      where: {
        programId,
        ...(opts?.search
          ? {
              OR: [
                { memberId: { contains: opts.search } },
                { externalId: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async function linkAccount(input: {
    memberId: string;
    programId: string;
    provider: string;
    externalId: string;
    externalBalance?: number;
  }): Promise<CoalitionAccountRow> {
    return prisma.coalitionAccount.create({
      data: {
        memberId: input.memberId,
        programId: input.programId,
        provider: input.provider,
        externalId: input.externalId,
        externalBalance: input.externalBalance ?? 0,
        lastSyncedAt: new Date(),
      },
    });
  }

  async function updateExternalBalance(accountId: string, balance: number): Promise<void> {
    await prisma.coalitionAccount.update({
      where: { id: accountId },
      data: { externalBalance: balance, lastSyncedAt: new Date() },
    });
  }

  // ── CoalitionTransaction ──────────────────────────────────────

  async function createTx(input: {
    accountId: string;
    type: "EARN" | "REDEEM";
    amount: number;
    localTxRef: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<CoalitionTransactionRow> {
    return prisma.coalitionTransaction.create({
      data: {
        accountId: input.accountId,
        type: input.type,
        amount: input.amount,
        localTxRef: input.localTxRef,
        idempotencyKey: input.idempotencyKey,
        status: "PENDING",
        attempts: 1,
        metadata:
          input.metadata != null ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  }

  async function findTxByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<CoalitionTransactionRow | null> {
    return prisma.coalitionTransaction.findUnique({
      where: { idempotencyKey },
    });
  }

  async function findTxByLocalRef(localTxRef: string): Promise<CoalitionTransactionRow | null> {
    return prisma.coalitionTransaction.findFirst({
      where: { localTxRef },
    });
  }

  async function updateTxSuccess(
    txId: string,
    externalTxRef: string,
    externalBalanceAfter?: number,
  ): Promise<CoalitionTransactionRow> {
    return prisma.coalitionTransaction.update({
      where: { id: txId },
      data: {
        status: "CONFIRMED",
        externalTxRef,
        metadata: externalBalanceAfter != null ? { externalBalanceAfter } : undefined,
      },
    });
  }

  async function updateTxFailed(
    txId: string,
    error: string,
    attempts: number,
  ): Promise<CoalitionTransactionRow> {
    return prisma.coalitionTransaction.update({
      where: { id: txId },
      data: { status: "FAILED", lastError: error, attempts },
    });
  }

  async function unlinkAccount(accountId: string): Promise<void> {
    await prisma.coalitionAccount.delete({
      where: { id: accountId },
    });
  }

  async function listTransactions(input: {
    programId: string;
    status?: string;
    memberId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<CoalitionTransactionRow[]> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;

    return prisma.coalitionTransaction.findMany({
      where: {
        account: { programId: input.programId },
        ...(input.status
          ? { status: input.status as "PENDING" | "CONFIRMED" | "FAILED" | "REVERSED" }
          : {}),
        ...(input.memberId ? { account: { memberId: input.memberId } } : {}),
        ...(input.from != null || input.to != null
          ? {
              createdAt: {
                ...(input.from != null ? { gte: input.from } : {}),
                ...(input.to != null ? { lte: input.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async function updateTxReversed(txId: string, reason: string): Promise<void> {
    await prisma.coalitionTransaction.update({
      where: { id: txId },
      data: {
        status: "REVERSED",
        lastError: reason,
      },
    });
  }

  return {
    getConfig,
    upsertConfig,
    updateCircuitState,
    getAccount,
    getAccountById,
    getAccountByExternalRef,
    listAccounts,
    linkAccount,
    unlinkAccount,
    listTransactions,
    updateExternalBalance,
    createTx,
    findTxByIdempotencyKey,
    findTxByLocalRef,
    updateTxSuccess,
    updateTxFailed,
    updateTxReversed,
  };
}

export type Repository = ReturnType<typeof createRepository>;

import { PointsService } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import CircuitBreaker from "opossum";

import type { Repository } from "./repository.js";
import { createRepository } from "./repository.js";
import type {
  AccumulateInput,
  AdapterCapabilities,
  CoalitionAdapter,
  CoalitionOperationResult,
  ConvertInput,
  RedeemInput,
} from "./types.js";
import {
  CoalitionAccountNotLinkedError,
  CoalitionBusinessError,
  CoalitionCircuitOpenError,
  CoalitionConfigNotFoundError,
  CoalitionTransientError,
  CoalitionUnsupportedError,
} from "./types.js";

function isTransientError(error: Error): boolean {
  // Coalition-specific transient errors
  if (error instanceof CoalitionTransientError) return true;
  if (error instanceof CoalitionBusinessError) return false;
  if (error instanceof CoalitionCircuitOpenError) return false;
  if (error instanceof CoalitionConfigNotFoundError) return false;
  if (error instanceof CoalitionAccountNotLinkedError) return false;
  if (error instanceof CoalitionUnsupportedError) return false;

  // Network / HTTP errors are transient
  const message = error.message.toLowerCase();
  if (
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("network") ||
    message.includes("fetch failed")
  ) {
    return true;
  }

  return false;
}

const RETRY_OPTIONS = {
  attempts: 3,
  backoff: "exponential" as const,
  initialDelay: 1000,
  maxDelay: 8000,
};

const BREAKER_OPTIONS: CircuitBreaker.Options = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  volumeThreshold: 5,
  resetTimeout: 30000,
  rollingCountTimeout: 10000,
};

export class CoalitionService {
  private repo: Repository;
  private pointsService: PointsService;
  private adapters: Map<string, CoalitionAdapter>;
  private breakers: Map<string, CircuitBreaker>;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
    this.pointsService = new PointsService(prisma);
    this.adapters = new Map();
    this.breakers = new Map();
  }

  // ── Adapter Management ────────────────────────────────────────

  /** Register a coalition adapter implementation. */
  registerAdapter(adapter: CoalitionAdapter): void {
    this.adapters.set(adapter.name, adapter);

    // Create a circuit breaker for this adapter
    if (!this.breakers.has(adapter.name)) {
      const breaker = new CircuitBreaker(
        async (fn: () => Promise<unknown>) => fn(),
        BREAKER_OPTIONS,
      );
      breaker.on("open", () => {
        console.warn(`[Coalition] Circuit breaker OPEN for adapter "${adapter.name}"`);
      });
      breaker.on("halfOpen", () => {
        console.info(`[Coalition] Circuit breaker HALF-OPEN for adapter "${adapter.name}"`);
      });
      breaker.on("close", () => {
        console.info(`[Coalition] Circuit breaker CLOSED for adapter "${adapter.name}"`);
      });
      this.breakers.set(adapter.name, breaker);
    }
  }

  /** Returns the active adapter for a program based on its CoalitionConfig. */
  async getActiveAdapter(programId: string): Promise<CoalitionAdapter> {
    const config = await this.repo.getConfig(programId);
    if (!config) {
      throw new CoalitionConfigNotFoundError(programId);
    }

    const adapter = this.adapters.get(config.provider);
    if (!adapter) {
      throw new Error(
        `No adapter registered for provider "${config.provider}". ` +
          `Registered: ${Array.from(this.adapters.keys()).join(", ") || "(none)"}`,
      );
    }

    return adapter;
  }

  // ── Public Operations ─────────────────────────────────────────

  async accumulate(input: AccumulateInput): Promise<CoalitionOperationResult> {
    return this.executeWithTwoPhaseCommit("EARN", "accumulationEnabled", input);
  }

  async redeem(input: RedeemInput): Promise<CoalitionOperationResult> {
    return this.executeWithTwoPhaseCommit("REDEEM", "redemptionEnabled", input);
  }

  async convert(input: ConvertInput): Promise<CoalitionOperationResult> {
    const { programId, memberId, externalMemberRef, ownPoints, txRef } = input;

    // 1. Load config and validate
    const config = await this.repo.getConfig(programId);
    if (!config) throw new CoalitionConfigNotFoundError(programId);
    if (!config.conversionEnabled) {
      throw new CoalitionBusinessError("Conversion is not enabled for this program");
    }
    if (ownPoints < config.minConversionPoints) {
      throw new CoalitionBusinessError(
        `Minimum conversion is ${String(config.minConversionPoints)} points`,
      );
    }

    // 2. Idempotency check
    const existing = await this.repo.findTxByLocalRef(txRef);
    if (existing) {
      return {
        txId: existing.id,
        externalTxId: existing.externalTxRef ?? undefined,
        status: existing.status,
        idempotent: true,
      };
    }

    // 3. Load account
    const account = await this.repo.getAccount(memberId, programId);
    if (!account) throw new CoalitionAccountNotLinkedError(memberId, programId);

    // 4. Create PENDING tx
    const tx = await this.repo.createTx({
      accountId: account.id,
      type: "REDEEM",
      amount: ownPoints,
      localTxRef: txRef,
      idempotencyKey: `convert-${txRef}`,
    });

    // 5. Call adapter.convert() with retry + circuit breaker
    try {
      const adapter = await this.getActiveAdapter(programId);
      this.requireCapability(adapter, "convert", "convert");

      const adapterResult = await this.callWithRetry(() => {
        if (!adapter.convert) throw new CoalitionUnsupportedError("convert", adapter.name);
        return adapter.convert(externalMemberRef, ownPoints, txRef);
      });

      await this.repo.updateTxSuccess(
        tx.id,
        adapterResult.externalTxId,
        adapterResult.balanceAfter,
      );
      await this.repo.updateExternalBalance(
        account.id,
        adapterResult.balanceAfter ?? account.externalBalance,
      );

      // 6. Redeem own points locally
      try {
        await this.pointsService.redeem({
          memberId,
          programId,
          amount: ownPoints,
          source: `coalition:convert:${adapterResult.externalTxId}`,
          idempotencyKey: `local-debit-${txRef}`,
        });

        // 7. Calculate and earn converted points
        const coalitionPoints = Math.round(ownPoints * config.conversionRate);
        await this.pointsService.earn({
          memberId,
          programId,
          amount: coalitionPoints,
          source: `coalition:convert:${adapterResult.externalTxId}`,
          idempotencyKey: `local-credit-${txRef}`,
          metadata: { coalitionTxId: adapterResult.externalTxId },
        });
      } catch (coreError) {
        // Compensation: reverse the external operation (if supported)
        const reason =
          coreError instanceof Error ? coreError.message : "Local core operation failed";
        if (adapter.capabilities.reverseTransaction) {
          try {
            if (!adapter.reverseTransaction) {
              throw new CoalitionUnsupportedError("reverseTransaction", adapter.name);
            }
            await adapter.reverseTransaction(adapterResult.externalTxId, reason);
            await this.repo.updateTxReversed(tx.id, reason);
          } catch (reverseError) {
            console.error(
              `[Coalition] Compensation reversal failed for ${adapterResult.externalTxId}:`,
              reverseError,
            );
            await this.repo.updateTxFailed(
              tx.id,
              `Local core failed AND compensation reversal failed: ${reason}`,
              tx.attempts,
            );
          }
        } else {
          await this.repo.updateTxFailed(
            tx.id,
            `Local core failed (reverse not supported by adapter): ${reason}`,
            tx.attempts,
          );
        }
        throw new CoalitionBusinessError(
          `Convert: local operation failed, reversal attempted: ${reason}`,
        );
      }

      return {
        txId: tx.id,
        externalTxId: adapterResult.externalTxId,
        status: "CONFIRMED",
        balanceAfter: adapterResult.balanceAfter,
        idempotent: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.repo.updateTxFailed(tx.id, error.message, tx.attempts + 1);
      throw error;
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private async executeWithTwoPhaseCommit(
    txType: "EARN" | "REDEEM",
    toggleField: "accumulationEnabled" | "redemptionEnabled",
    input: AccumulateInput | RedeemInput,
  ): Promise<CoalitionOperationResult> {
    const { programId, memberId, externalMemberRef, points, txRef, metadata } = input;

    // 1. Load config and validate
    const config = await this.repo.getConfig(programId);
    if (!config) throw new CoalitionConfigNotFoundError(programId);
    if (!config[toggleField]) {
      throw new CoalitionBusinessError(
        `${txType === "EARN" ? "Accumulation" : "Redemption"} is not enabled for this program`,
      );
    }

    // 2. Idempotency check
    const existing = await this.repo.findTxByLocalRef(txRef);
    if (existing) {
      return {
        txId: existing.id,
        externalTxId: existing.externalTxRef ?? undefined,
        status: existing.status,
        idempotent: true,
      };
    }

    // 3. Load or create account
    let account = await this.repo.getAccount(memberId, programId);
    if (!account) {
      account = await this.repo.linkAccount({
        memberId,
        programId,
        provider: config.provider,
        externalId: externalMemberRef,
      });
    }

    // 4. Create PENDING tx (Phase 1)
    const tx = await this.repo.createTx({
      accountId: account.id,
      type: txType,
      amount: points,
      localTxRef: txRef,
      idempotencyKey: `${txType.toLowerCase()}-${txRef}`,
      metadata: metadata as Record<string, unknown> | undefined,
    });

    // 5. Call adapter with retry + circuit breaker (Phase 2)
    try {
      const adapter = await this.getActiveAdapter(programId);

      if (txType === "REDEEM") {
        this.requireCapability(adapter, "redeem", "redeem");
      }

      const adapterFn = () => {
        if (txType === "EARN") {
          return adapter.accumulate(externalMemberRef, points, txRef, metadata);
        }
        if (!adapter.redeem) {
          throw new CoalitionUnsupportedError("redeem", adapter.name);
        }
        return adapter.redeem(externalMemberRef, points, txRef, metadata);
      };

      const adapterResult = await this.callWithRetry(adapterFn);
      await this.repo.updateTxSuccess(
        tx.id,
        adapterResult.externalTxId,
        adapterResult.balanceAfter,
      );
      await this.repo.updateExternalBalance(
        account.id,
        adapterResult.balanceAfter ?? account.externalBalance,
      );

      return {
        txId: tx.id,
        externalTxId: adapterResult.externalTxId,
        status: "CONFIRMED",
        balanceAfter: adapterResult.balanceAfter,
        idempotent: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.repo.updateTxFailed(tx.id, error.message, tx.attempts + 1);
      throw error;
    }
  }

  /** Calls `fn` through the circuit breaker with retry logic. */
  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const adapter = this.getAnyAdapter(); // used only for breaker identification
    const breaker = adapter ? this.breakers.get(adapter.name) : undefined;

    let lastError: Error | undefined;
    let delay = RETRY_OPTIONS.initialDelay;

    for (let attempt = 1; attempt <= RETRY_OPTIONS.attempts; attempt++) {
      try {
        if (breaker) {
          return (await breaker.fire(fn as () => Promise<unknown>)) as T;
        }
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!isTransientError(lastError) || attempt === RETRY_OPTIONS.attempts) {
          throw lastError;
        }
        await sleep(delay);
        delay = Math.min(delay * 2, RETRY_OPTIONS.maxDelay);
      }
    }
    throw lastError ?? new Error("Retry exhausted with no error captured");
  }

  private getAnyAdapter(): CoalitionAdapter | undefined {
    return this.adapters.values().next().value;
  }

  /** Throws CoalitionUnsupportedError if the adapter does not support the given capability. */
  private requireCapability(
    adapter: CoalitionAdapter,
    capability: keyof AdapterCapabilities,
    method: string,
  ): void {
    if (!adapter.capabilities[capability]) {
      throw new CoalitionUnsupportedError(method, adapter.name);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

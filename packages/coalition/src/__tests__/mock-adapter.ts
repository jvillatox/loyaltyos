import type { CoalitionAdapter, TxResult } from "../types.js";
import { CoalitionBusinessError, CoalitionTransientError } from "../types.js";

export interface MockAdapterOptions {
  /** Simulated network latency in ms. */
  latency?: number;
  /** Number of transient errors to throw before succeeding. */
  transientFails?: number;
  /** Business error to throw immediately (no retries). */
  businessError?: string;
  /** Override balance returned by getBalance. */
  balanceOverride?: number;
  /** Fixed externalTxId to return. */
  externalTxId?: string;
  /** Fixed balanceAfter in TxResult. */
  balanceAfter?: number;
}

export class MockAdapter implements CoalitionAdapter {
  name = "mock";
  latency: number;
  transientFails: number;
  businessError: string | undefined;
  balanceOverride: number;
  externalTxId: string;
  balanceAfter: number;

  // Spies for test assertions
  accumulateCalls: {
    externalMemberRef: string;
    points: number;
    txRef: string;
    metadata?: object;
  }[] = [];
  redeemCalls: {
    externalMemberRef: string;
    points: number;
    txRef: string;
    metadata?: object;
  }[] = [];
  convertCalls: {
    externalMemberRef: string;
    ownPoints: number;
    txRef: string;
  }[] = [];
  healthcheckCalls = 0;
  getBalanceCalls: string[] = [];
  reverseCalls: { txRef: string; reason: string }[] = [];

  private transientCount = 0;

  constructor(options: MockAdapterOptions = {}) {
    this.latency = options.latency ?? 0;
    this.transientFails = options.transientFails ?? 0;
    this.businessError = options.businessError;
    this.balanceOverride = options.balanceOverride ?? 0;
    this.externalTxId = options.externalTxId ?? "mock-ext-tx-1";
    this.balanceAfter = options.balanceAfter ?? 1000;
  }

  private async delay(): Promise<void> {
    if (this.latency > 0) {
      await new Promise((r) => setTimeout(r, this.latency));
    }
  }

  private maybeThrow(): void {
    if (this.businessError) {
      throw new CoalitionBusinessError(this.businessError);
    }
    if (this.transientCount < this.transientFails) {
      this.transientCount++;
      throw new CoalitionTransientError(
        `Transient failure ${String(this.transientCount)}/${String(this.transientFails)}`,
      );
    }
  }

  private makeResult(): TxResult {
    return {
      externalTxId: this.externalTxId,
      balanceAfter: this.balanceAfter,
    };
  }

  async healthcheck(): Promise<{ ok: boolean; latencyMs?: number }> {
    this.healthcheckCalls++;
    await this.delay();
    return { ok: true, latencyMs: this.latency };
  }

  async getBalance(externalMemberRef: string): Promise<number> {
    this.getBalanceCalls.push(externalMemberRef);
    this.maybeThrow();
    await this.delay();
    return this.balanceOverride;
  }

  async accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult> {
    this.accumulateCalls.push({ externalMemberRef, points, txRef, metadata });
    this.maybeThrow();
    await this.delay();
    this.balanceAfter += points;
    return this.makeResult();
  }

  async redeem(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult> {
    this.redeemCalls.push({ externalMemberRef, points, txRef, metadata });
    this.maybeThrow();
    await this.delay();

    if (this.businessError) {
      throw new CoalitionBusinessError(this.businessError);
    }

    if (this.balanceOverride < points) {
      throw new CoalitionBusinessError(
        `Insufficient external balance: have ${String(this.balanceOverride)}, need ${String(points)}`,
      );
    }

    this.balanceAfter -= points;
    return this.makeResult();
  }

  async convert(externalMemberRef: string, ownPoints: number, txRef: string): Promise<TxResult> {
    this.convertCalls.push({ externalMemberRef, ownPoints, txRef });
    this.maybeThrow();
    await this.delay();
    this.balanceAfter += ownPoints;
    return this.makeResult();
  }

  async reverseTransaction(txRef: string, reason: string): Promise<void> {
    this.reverseCalls.push({ txRef, reason });
    await this.delay();
  }
}

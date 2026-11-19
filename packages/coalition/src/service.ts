import { PointsService } from "@loyaltyos/core";
import type { PrismaClient } from "@prisma/client";
import CircuitBreaker from "opossum";

import { createApprecioAdapter } from "./adapters/apprecio.js";
import {
  APPRECIO_BASE_URLS,
  type ApprecioCountry,
  type IdentifierType,
} from "./adapters/apprecio.types.js";
import { decrypt, getMasterKey } from "./crypto.js";
import type { Repository } from "./repository.js";
import { createRepository } from "./repository.js";
import type {
  AccumulateInput,
  AdapterCapabilities,
  CoalitionAccountRow,
  CoalitionAdapter,
  CoalitionConfigRow,
  CoalitionOperationResult,
  CoalitionTransactionRow,
  ConvertInput,
  MemberHistoryEntry,
  RedeemInput,
  TxResult,
} from "./types.js";
import {
  CoalitionAccountNotLinkedError,
  CoalitionBusinessError,
  CoalitionCircuitOpenError,
  CoalitionConfigNotFoundError,
  CoalitionDuplicateTsError,
  CoalitionTransientError,
  CoalitionUnsupportedError,
} from "./types.js";

// The breaker must fire after the adapter's own upstream timeout so the adapter
// always has the first chance to surface a transient error. The +2000ms margin
// accounts for the adapter's own abort handling.
const BREAKER_TIMEOUT_PADDING_MS = 2000;

const BREAKER_OPTIONS: CircuitBreaker.Options = {
  errorThresholdPercentage: 50,
  volumeThreshold: 5,
  resetTimeout: 30000,
  rollingCountTimeout: 10000,
};

// Reconciliation windows (see reconcilePendingTransaction).
const RECONCILE_RETRY_INTERVAL_MS = 5 * 60 * 1000; // claim a tx at most once per 5 min
const RECONCILE_NEEDS_REVIEW_AGE_MS = 24 * 60 * 60 * 1000; // unresolved after 24h → review

export interface CoalitionServiceMetrics {
  recordOperation(provider: string, operation: string, status: string, idempotent: boolean): void;
  setCircuitBreakerState(adapter: string, state: number): void;
  recordNeedsReview(provider: string): void;
}

interface ApprecioCredentials {
  publicToken?: string;
  privateToken?: string;
  timeoutMs?: number;
  identifierType?: IdentifierType;
}

/** A per-program adapter plus the breaker key and the config version it was built from. */
interface CachedProgramAdapter {
  adapter: CoalitionAdapter;
  breakerKey: string;
  updatedAt: Date;
}

// Fields a partner's history entry may use to identify the owning member. When
// an entry carries none of these, the partner's format cannot be filtered per
// member with certainty, and the caller must fall back to local history.
const MEMBER_IDENTIFIER_FIELDS = [
  "email",
  "rut",
  "correo",
  "externalId",
  "externalMemberRef",
  "memberId",
  "identificador",
  "usuario",
  "identifier",
] as const;

function extractMemberIdentifier(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  for (const field of MEMBER_IDENTIFIER_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * Normalizes a member identifier so two spellings of the same value compare
 * equal: emails are compared case-insensitively, and RUTs are compared with
 * dots and hyphens stripped (check digit uppercased).
 */
function normalizeMemberIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }
  return trimmed.replace(/[.\-\s]/g, "").toUpperCase();
}

/**
 * Keeps only the entries whose member identifier matches `externalId`. Returns
 * `null` when the entries do not expose a member identifier (so the result could
 * not be filtered with certainty); the caller then falls back to local history.
 */
function filterHistoryByMember(entries: unknown[], externalId: string): unknown[] | null {
  if (entries.length === 0) return [];
  const normalizedExternalId = normalizeMemberIdentifier(externalId);
  const result: unknown[] = [];
  for (const entry of entries) {
    const identifier = extractMemberIdentifier(entry);
    if (identifier === null) return null;
    if (normalizeMemberIdentifier(identifier) === normalizedExternalId) result.push(entry);
  }
  return result;
}

/**
 * A convert() transaction is stored with type "REDEEM" but carries local
 * debit + credit side effects; a plain redeem() does not. The idempotency key
 * prefix is the reliable signal (convert- vs redeem-).
 */
function isConvertTransaction(tx: CoalitionTransactionRow): boolean {
  return tx.type === "REDEEM" && tx.idempotencyKey.startsWith("convert-");
}

/** Outcome of a single reconciliation attempt. */
export type ReconcileOutcome =
  | "not_found"
  | "not_pending"
  | "claimed_by_other"
  | "confirmed"
  | "needs_review"
  | "failed"
  | "still_pending";

export class CoalitionService {
  private repo: Repository;
  private pointsService: PointsService;
  private adapters: Map<string, CoalitionAdapter>;
  private programAdapters: Map<string, CachedProgramAdapter>;
  private breakers: Map<string, CircuitBreaker>;
  private adapterBreakerKeys: Map<CoalitionAdapter, string>;
  private metrics?: CoalitionServiceMetrics;

  constructor(prisma: PrismaClient, metrics?: CoalitionServiceMetrics) {
    this.repo = createRepository(prisma);
    this.pointsService = new PointsService(prisma);
    this.adapters = new Map();
    this.programAdapters = new Map();
    this.breakers = new Map();
    this.adapterBreakerKeys = new Map();
    this.metrics = metrics;
  }

  // ── Adapter Management ────────────────────────────────────────

  /**
   * Register a coalition adapter implementation. `breakerKey` names the circuit
   * breaker entry; the env fallback passes "apprecio:env" so it never shares a
   * breaker with per-program "apprecio:<programId>" entries.
   */
  registerAdapter(adapter: CoalitionAdapter, breakerKey?: string): void {
    this.adapters.set(adapter.name, adapter);
    const key = breakerKey ?? adapter.name;
    this.adapterBreakerKeys.set(adapter, key);
    this.ensureBreaker(key, adapter.timeoutMs);
  }

  private createBreaker(key: string, timeoutMs: number): CircuitBreaker {
    const breaker = new CircuitBreaker(async (fn: () => Promise<unknown>) => fn(), {
      ...BREAKER_OPTIONS,
      timeout: timeoutMs + BREAKER_TIMEOUT_PADDING_MS,
    });
    breaker.on("open", () => {
      console.warn(`[Coalition] Circuit breaker OPEN for adapter "${key}"`);
      this.metrics?.setCircuitBreakerState(key, 2);
    });
    breaker.on("halfOpen", () => {
      console.info(`[Coalition] Circuit breaker HALF-OPEN for adapter "${key}"`);
      this.metrics?.setCircuitBreakerState(key, 1);
    });
    breaker.on("close", () => {
      console.info(`[Coalition] Circuit breaker CLOSED for adapter "${key}"`);
      this.metrics?.setCircuitBreakerState(key, 0);
    });
    return breaker;
  }

  private ensureBreaker(key: string, timeoutMs: number): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing) return existing;
    const breaker = this.createBreaker(key, timeoutMs);
    this.breakers.set(key, breaker);
    return breaker;
  }

  /** Replaces a breaker (shutting down the old one) so stale state does not leak into a new config. */
  private replaceBreaker(key: string, timeoutMs: number): CircuitBreaker {
    this.breakers.get(key)?.shutdown();
    const breaker = this.createBreaker(key, timeoutMs);
    this.breakers.set(key, breaker);
    return breaker;
  }

  /** Returns the active adapter for a program based on its CoalitionConfig. */
  async getActiveAdapter(programId: string): Promise<CoalitionAdapter> {
    const config = await this.repo.getConfig(programId);
    if (config) {
      return this.adapterForConfig(config);
    }

    // Legacy single-program installs: no per-program config, so fall back to the
    // adapter registered from the deprecated APPRECIO_* env vars. This is only
    // safe when the installation has exactly one program — with more, a missing
    // config is an error and the caller must configure each program explicitly.
    const envAdapter = this.adapters.get("apprecio") ?? this.adapters.get("APPRECIO");
    if (envAdapter) {
      const programCount = await this.repo.countPrograms();
      if (programCount <= 1) {
        return envAdapter;
      }
    }

    throw new CoalitionConfigNotFoundError(programId);
  }

  /** Resolves (and caches) the adapter for a program's CoalitionConfig. */
  private adapterForConfig(config: CoalitionConfigRow): CoalitionAdapter {
    if (config.provider.toUpperCase() === "APPRECIO") {
      const breakerKey = `apprecio:${config.programId}`;
      const cached = this.programAdapters.get(config.programId);

      // Cache is valid only for the exact config version it was built from. A
      // different `updatedAt` (e.g. tokens changed in another instance) rebuilds
      // the adapter and replaces its breaker so the new credentials take effect.
      if (cached && cached.updatedAt.getTime() === config.updatedAt.getTime()) {
        return cached.adapter;
      }

      const adapter = this.buildApprecioAdapter(config);
      this.programAdapters.set(config.programId, {
        adapter,
        breakerKey,
        updatedAt: config.updatedAt,
      });
      this.adapterBreakerKeys.set(adapter, breakerKey);
      if (cached) {
        this.replaceBreaker(breakerKey, adapter.timeoutMs);
      } else {
        this.ensureBreaker(breakerKey, adapter.timeoutMs);
      }
      return adapter;
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

  /** Builds an Apprecio adapter from a program's decrypted CoalitionConfig. */
  private buildApprecioAdapter(config: CoalitionConfigRow): CoalitionAdapter {
    let credentials: ApprecioCredentials = {};
    try {
      credentials = JSON.parse(
        decrypt(config.encryptedCredentials, getMasterKey()),
      ) as ApprecioCredentials;
    } catch {
      // Fall through: missing/invalid credentials surface as a clear error below.
    }

    if (!credentials.publicToken || !credentials.privateToken) {
      throw new CoalitionBusinessError(
        `Apprecio credentials are not configured for program "${config.programId}"`,
      );
    }

    const country = config.country;
    let apiBase = config.endpoint;
    if (country && country !== "OTHER" && country in APPRECIO_BASE_URLS) {
      apiBase = APPRECIO_BASE_URLS[country as ApprecioCountry];
    }

    const identifierType: IdentifierType =
      (config.identifierType as IdentifierType | null) ?? credentials.identifierType ?? "email";

    return createApprecioAdapter({
      apiBase,
      publicToken: credentials.publicToken,
      privateToken: credentials.privateToken,
      identifierType,
      timeoutMs: credentials.timeoutMs,
    });
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
    const existing = await this.repo.findTxByLocalRef(programId, txRef);
    if (existing) {
      this.metrics?.recordOperation(config.provider, "CONVERT", existing.status, true);
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
      programId,
      type: "REDEEM",
      amount: ownPoints,
      localTxRef: txRef,
      idempotencyKey: `convert-${txRef}`,
    });

    // 5. Call adapter.convert() with retry + circuit breaker
    try {
      const adapter = await this.getActiveAdapter(programId);
      this.requireCapability(adapter, "convert", "convert");

      const adapterResult = await this.callAdapter(adapter, () => {
        if (!adapter.convert) throw new CoalitionUnsupportedError("convert", adapter.name);
        return adapter.convert(externalMemberRef, ownPoints, txRef, tx.id);
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

      // 6. Redeem own points locally, then earn converted points. Idempotent
      // keys derived from txRef allow reconciliation to re-run this safely.
      try {
        await this.applyConvertLocalPoints(config, account, tx, adapterResult.externalTxId);
      } catch (coreError) {
        // Compensation: reverse the external operation (if supported)
        const reason =
          coreError instanceof Error ? coreError.message : "Local core operation failed";
        await this.compensateConvert(adapter, tx, adapterResult.externalTxId, reason);
        throw new CoalitionBusinessError(
          `Convert: local operation failed, reversal attempted: ${reason}`,
        );
      }

      this.metrics?.recordOperation(config.provider, "CONVERT", "CONFIRMED", false);

      return {
        txId: tx.id,
        externalTxId: adapterResult.externalTxId,
        status: "CONFIRMED",
        balanceAfter: adapterResult.balanceAfter,
        idempotent: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error instanceof CoalitionTransientError) {
        await this.repo.updateTxPending(tx.id, error.message, tx.attempts + 1);
        this.metrics?.recordOperation(config.provider, "CONVERT", "PENDING", false);
        throw error;
      }
      await this.repo.updateTxFailed(tx.id, error.message, tx.attempts + 1);
      this.metrics?.recordOperation(config.provider, "CONVERT", "FAILED", false);
      throw error;
    }
  }

  async getExternalBalance(memberId: string, programId: string): Promise<number> {
    const adapter = await this.getActiveAdapter(programId);
    const account = await this.repo.getAccount(memberId, programId);
    if (!account) throw new CoalitionAccountNotLinkedError(memberId, programId);
    return adapter.getBalance(account.externalId);
  }

  /**
   * Returns the member's own local coalition transactions, trimmed to the safe
   * fields only (no lastError, metadata, idempotencyKey, accountId or external
   * references). This is the member-facing path and never exposes the partner's
   * raw history.
   */
  async getLocalHistory(
    memberId: string,
    programId: string,
    from?: Date,
    to?: Date,
  ): Promise<MemberHistoryEntry[]> {
    const rows = await this.repo.listMemberTransactions(programId, memberId, from, to);
    return rows.map(({ id, type, amount, status, createdAt }) => ({
      id,
      type,
      amount,
      status,
      createdAt,
    }));
  }

  /**
   * Server-side history: query the partner and filter to the member's entries.
   * When the partner's format cannot be filtered per member with certainty, fall
   * back to the member's local transactions so no other member's data is returned.
   */
  async getExternalHistory(
    memberId: string,
    programId: string,
    from: Date,
    to: Date,
  ): Promise<unknown[]> {
    const account = await this.repo.getAccount(memberId, programId);
    if (!account) throw new CoalitionAccountNotLinkedError(memberId, programId);

    const adapter = await this.getActiveAdapter(programId);
    if (!adapter.capabilities.historyQuery || !adapter.queryHistory) {
      return this.repo.listMemberTransactions(programId, memberId, from, to);
    }

    const entries = await adapter.queryHistory(account.externalId, from, to);
    const filtered = filterHistoryByMember(entries, account.externalId);
    return filtered ?? (await this.repo.listMemberTransactions(programId, memberId, from, to));
  }

  async linkExternalAccount(input: {
    memberId: string;
    programId: string;
    externalMemberRef: string;
  }): Promise<CoalitionAccountRow> {
    const config = await this.repo.getConfig(input.programId);
    if (!config) throw new CoalitionConfigNotFoundError(input.programId);
    return this.repo.linkAccount({
      memberId: input.memberId,
      programId: input.programId,
      provider: config.provider,
      externalId: input.externalMemberRef,
    });
  }

  async listLinkedAccounts(
    programId: string,
    opts?: { search?: string; page?: number; pageSize?: number },
  ): Promise<CoalitionAccountRow[]> {
    return this.repo.listAccounts(programId, opts);
  }

  async unlinkExternalAccount(memberId: string, programId: string): Promise<void> {
    const account = await this.repo.getAccount(memberId, programId);
    if (!account) throw new CoalitionAccountNotLinkedError(memberId, programId);
    await this.repo.unlinkAccount(account.id);
  }

  async getConfig(programId: string): Promise<CoalitionConfigRow | null> {
    return this.repo.getConfig(programId);
  }

  async upsertConfig(input: {
    programId: string;
    provider?: string;
    endpoint: string;
    country?: string | null;
    identifierType?: string | null;
    encryptedCredentials: string;
    conversionRate?: number;
    accumulationEnabled?: boolean;
    redemptionEnabled?: boolean;
    conversionEnabled?: boolean;
    minConversionPoints?: number;
  }): Promise<CoalitionConfigRow> {
    const result = await this.repo.upsertConfig(input);
    // The credentials/endpoint may have changed — drop the cached adapter so the
    // next operation rebuilds it from the fresh config (and a fresh breaker).
    const cached = this.programAdapters.get(input.programId);
    if (cached) {
      this.adapterBreakerKeys.delete(cached.adapter);
    }
    this.programAdapters.delete(input.programId);
    return result;
  }

  async healthcheck(
    programId: string,
  ): Promise<{ ok: boolean; latencyMs?: number; details?: unknown }> {
    const adapter = await this.getActiveAdapter(programId);
    return adapter.healthcheck();
  }

  async getAdapterCapabilities(programId: string): Promise<AdapterCapabilities> {
    const adapter = await this.getActiveAdapter(programId);
    return adapter.capabilities;
  }

  async listTransactions(
    programId: string,
    filters: {
      status?: string;
      memberId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    },
  ): Promise<CoalitionTransactionRow[]> {
    return this.repo.listTransactions({ programId, ...filters });
  }

  async reverseCoalitionTransaction(
    programId: string,
    txRef: string,
    reason: string,
  ): Promise<void> {
    const tx = await this.repo.findTxByLocalRef(programId, txRef);
    if (!tx) {
      throw new CoalitionBusinessError(`Transaction "${txRef}" not found`);
    }
    if (tx.status === "REVERSED") {
      throw new CoalitionBusinessError(`Transaction "${txRef}" is already reversed`);
    }
    if (!tx.externalTxRef) {
      throw new CoalitionBusinessError(
        `Transaction "${txRef}" has no external reference to reverse`,
      );
    }

    // Get the account to find the programId, then the adapter
    const account = await this.repo.getAccountById(tx.accountId);
    if (!account) {
      throw new CoalitionBusinessError("Account not found for transaction");
    }

    const adapter = await this.getActiveAdapter(account.programId);
    if (!adapter.capabilities.reverseTransaction) {
      throw new CoalitionUnsupportedError("reverseTransaction", adapter.name);
    }
    if (!adapter.reverseTransaction) {
      throw new CoalitionUnsupportedError("reverseTransaction", adapter.name);
    }

    await adapter.reverseTransaction(tx.externalTxRef, reason);
    await this.repo.updateTxReversed(tx.id, reason);
  }

  /**
   * Reconciles a single PENDING transaction by re-issuing the same external
   * operation with the same `ts` (the transaction id). The claim (via
   * `lastAttemptAt`) makes this safe to run concurrently from two instances.
   *
   * - success → CONFIRMED
   * - duplicate-ts + matching history → CONFIRMED
   * - duplicate-ts without matching history → NEEDS_REVIEW (nothing assumed)
   * - business error (not duplicate-ts) → FAILED (convert local points reversed)
   * - transient → stays PENDING (attempts+1), NEEDS_REVIEW after 24h
   */
  async reconcilePendingTransaction(
    txId: string,
    options: { force?: boolean } = {},
  ): Promise<ReconcileOutcome> {
    const tx = await this.repo.getTxById(txId);
    if (!tx) return "not_found";

    const allowed = options.force ? ["PENDING", "NEEDS_REVIEW"] : ["PENDING"];
    if (!allowed.includes(tx.status)) return "not_pending";

    const account = await this.repo.getAccountById(tx.accountId);
    if (!account) {
      await this.repo.updateTxNeedsReview(txId, "Coalition account no longer exists");
      this.alertNeedsReview("", "unknown", tx);
      return "needs_review";
    }

    const now = new Date();
    const interval = options.force ? 0 : RECONCILE_RETRY_INTERVAL_MS;
    const claimed = await this.repo.claimTx(txId, now, interval, tx.status);
    if (!claimed) return "claimed_by_other";

    const config = await this.repo.getConfig(account.programId);
    if (!config) {
      await this.repo.updateTxNeedsReview(txId, "No coalition config for program");
      this.alertNeedsReview(account.programId, account.provider, claimed);
      return "needs_review";
    }

    let adapter: CoalitionAdapter;
    try {
      adapter = await this.getActiveAdapter(account.programId);
    } catch (err) {
      await this.repo.updateTxPending(txId, (err as Error).message, claimed.attempts);
      return "still_pending";
    }

    try {
      const adapterResult = await this.runExternalOperation(adapter, account, claimed);
      if (isConvertTransaction(claimed)) {
        await this.applyConvertLocalPoints(config, account, claimed, adapterResult.externalTxId);
      }
      await this.repo.updateTxSuccess(
        claimed.id,
        adapterResult.externalTxId,
        adapterResult.balanceAfter,
      );
      await this.repo.updateExternalBalance(
        account.id,
        adapterResult.balanceAfter ?? account.externalBalance,
      );
      this.metrics?.recordOperation(config.provider, claimed.type, "CONFIRMED", false);
      return "confirmed";
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (error instanceof CoalitionDuplicateTsError) {
        const found = await this.historyContainsTxReference(
          adapter,
          account.externalId,
          claimed.id,
          claimed.createdAt,
          now,
        );
        if (found) {
          if (isConvertTransaction(claimed)) {
            await this.applyConvertLocalPoints(config, account, claimed, claimed.localTxRef);
          }
          await this.repo.updateTxSuccess(claimed.id, claimed.localTxRef, undefined);
          this.metrics?.recordOperation(config.provider, claimed.type, "CONFIRMED", false);
          return "confirmed";
        }
        await this.repo.updateTxNeedsReview(
          claimed.id,
          "Duplicate ts rejected but no matching history entry was found",
        );
        this.alertNeedsReview(account.programId, account.provider, claimed);
        return "needs_review";
      }

      if (error instanceof CoalitionBusinessError) {
        if (isConvertTransaction(claimed)) {
          await this.compensateConvert(adapter, claimed, claimed.localTxRef, error.message);
        }
        await this.repo.updateTxFailed(claimed.id, error.message, claimed.attempts);
        this.metrics?.recordOperation(config.provider, claimed.type, "FAILED", false);
        return "failed";
      }

      // Transient (or open circuit / breaker timeout): outcome still unknown.
      if (now.getTime() - claimed.createdAt.getTime() >= RECONCILE_NEEDS_REVIEW_AGE_MS) {
        await this.repo.updateTxNeedsReview(claimed.id, `Unresolved after 24h: ${error.message}`);
        this.alertNeedsReview(account.programId, account.provider, claimed);
        return "needs_review";
      }

      await this.repo.updateTxPending(claimed.id, error.message, claimed.attempts + 1);
      this.metrics?.recordOperation(config.provider, claimed.type, "PENDING", false);
      return "still_pending";
    }
  }

  /** Reconciles every PENDING transaction older than the retry window. */
  async runReconciliationSweep(now: Date = new Date()): Promise<{
    scanned: number;
    confirmed: number;
    failed: number;
    needsReview: number;
    stillPending: number;
    skipped: number;
  }> {
    const olderThan = new Date(now.getTime() - RECONCILE_RETRY_INTERVAL_MS);
    const txs = await this.repo.listPendingForReconciliation(olderThan);
    const summary = {
      scanned: txs.length,
      confirmed: 0,
      failed: 0,
      needsReview: 0,
      stillPending: 0,
      skipped: 0,
    };
    for (const tx of txs) {
      const outcome = await this.reconcilePendingTransaction(tx.id);
      if (outcome === "confirmed") summary.confirmed += 1;
      else if (outcome === "failed") summary.failed += 1;
      else if (outcome === "needs_review") summary.needsReview += 1;
      else if (outcome === "still_pending") summary.stillPending += 1;
      else summary.skipped += 1;
    }
    return summary;
  }

  /** Manual "retry now" for a PENDING/NEEDS_REVIEW transaction (super-admin). */
  async manuallyRetryTransaction(programId: string, txId: string): Promise<ReconcileOutcome> {
    const tx = await this.repo.getTxById(txId);
    if (!tx) throw new CoalitionBusinessError(`Transaction "${txId}" not found`);
    const account = await this.repo.getAccountById(tx.accountId);
    if (!account || account.programId !== programId) {
      throw new CoalitionBusinessError(`Transaction "${txId}" not found in program`);
    }
    if (tx.status !== "PENDING" && tx.status !== "NEEDS_REVIEW") {
      throw new CoalitionBusinessError(
        `Transaction "${txId}" is ${tx.status}; only PENDING or NEEDS_REVIEW can be retried`,
      );
    }
    return this.reconcilePendingTransaction(txId, { force: true });
  }

  /** Manual "mark as confirmed" for a PENDING/NEEDS_REVIEW transaction (super-admin). */
  async manuallyConfirmTransaction(
    programId: string,
    txId: string,
  ): Promise<CoalitionTransactionRow> {
    const tx = await this.repo.getTxById(txId);
    if (!tx) throw new CoalitionBusinessError(`Transaction "${txId}" not found`);
    const account = await this.repo.getAccountById(tx.accountId);
    if (!account || account.programId !== programId) {
      throw new CoalitionBusinessError(`Transaction "${txId}" not found in program`);
    }
    if (tx.status !== "PENDING" && tx.status !== "NEEDS_REVIEW") {
      throw new CoalitionBusinessError(
        `Transaction "${txId}" is ${tx.status}; only PENDING or NEEDS_REVIEW can be confirmed manually`,
      );
    }

    // A convert carries local debit + credit that only ever ran after external
    // success; apply them idempotently so a manual confirm keeps the ledger whole.
    if (isConvertTransaction(tx)) {
      const config = await this.repo.getConfig(account.programId);
      if (!config) throw new CoalitionConfigNotFoundError(account.programId);
      await this.applyConvertLocalPoints(config, account, tx, tx.localTxRef);
    }

    await this.repo.updateTxSuccess(tx.id, tx.externalTxRef ?? tx.localTxRef, undefined);
    this.metrics?.recordOperation(account.provider, tx.type, "CONFIRMED", false);
    return { ...tx, status: "CONFIRMED" };
  }

  /** Manual "mark as failed" for a PENDING/NEEDS_REVIEW transaction (super-admin). */
  async manuallyFailTransaction(
    programId: string,
    txId: string,
    comment: string,
  ): Promise<CoalitionTransactionRow> {
    const tx = await this.repo.getTxById(txId);
    if (!tx) throw new CoalitionBusinessError(`Transaction "${txId}" not found`);
    const account = await this.repo.getAccountById(tx.accountId);
    if (!account || account.programId !== programId) {
      throw new CoalitionBusinessError(`Transaction "${txId}" not found in program`);
    }
    if (tx.status !== "PENDING" && tx.status !== "NEEDS_REVIEW") {
      throw new CoalitionBusinessError(
        `Transaction "${txId}" is ${tx.status}; only PENDING or NEEDS_REVIEW can be failed manually`,
      );
    }
    await this.repo.updateTxFailed(tx.id, `Manual failure: ${comment}`, tx.attempts);
    this.metrics?.recordOperation(account.provider, tx.type, "FAILED", false);
    return { ...tx, status: "FAILED" };
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
    const existing = await this.repo.findTxByLocalRef(programId, txRef);
    if (existing) {
      this.metrics?.recordOperation(config.provider, txType, existing.status, true);
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
      programId,
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
          return adapter.accumulate(externalMemberRef, points, txRef, metadata, tx.id);
        }
        if (!adapter.redeem) {
          throw new CoalitionUnsupportedError("redeem", adapter.name);
        }
        return adapter.redeem(externalMemberRef, points, txRef, metadata);
      };

      const adapterResult = await this.callAdapter(adapter, adapterFn);
      await this.repo.updateTxSuccess(
        tx.id,
        adapterResult.externalTxId,
        adapterResult.balanceAfter,
      );
      await this.repo.updateExternalBalance(
        account.id,
        adapterResult.balanceAfter ?? account.externalBalance,
      );

      this.metrics?.recordOperation(config.provider, txType, "CONFIRMED", false);

      return {
        txId: tx.id,
        externalTxId: adapterResult.externalTxId,
        status: "CONFIRMED",
        balanceAfter: adapterResult.balanceAfter,
        idempotent: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error instanceof CoalitionTransientError) {
        // Outcome unknown: the adapter may or may not have applied the operation.
        // Leave the transaction PENDING so an operator can check the partner's
        // history before deciding whether to retry.
        await this.repo.updateTxPending(tx.id, error.message, tx.attempts + 1);
        this.metrics?.recordOperation(config.provider, txType, "PENDING", false);
        throw error;
      }
      await this.repo.updateTxFailed(tx.id, error.message, tx.attempts + 1);
      this.metrics?.recordOperation(config.provider, txType, "FAILED", false);
      throw error;
    }
  }

  /** Calls `fn` through the adapter's circuit breaker without auto-retry. */
  private async callAdapter<T>(adapter: CoalitionAdapter, fn: () => Promise<T>): Promise<T> {
    const breaker = this.breakers.get(this.adapterBreakerKeys.get(adapter) ?? adapter.name);

    if (!breaker) {
      return await fn();
    }

    try {
      return (await breaker.fire(fn as () => Promise<unknown>)) as T;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // A breaker timeout means the outcome is unknown: the adapter may still be
      // applying the operation upstream, so the transaction must stay PENDING.
      if (code === "ETIMEDOUT") {
        throw new CoalitionTransientError(
          `Coalition adapter "${adapter.name}" exceeded the circuit breaker timeout ` +
            `(${String(adapter.timeoutMs + BREAKER_TIMEOUT_PADDING_MS)}ms)`,
        );
      }
      // An open breaker never invoked the adapter, so the operation did not run.
      if (code === "EOPENBREAKER") {
        throw new CoalitionCircuitOpenError(adapter.name);
      }
      throw err;
    }
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

  /**
   * Re-issues the external operation for a stored transaction using the SAME
   * `ts` (the transaction id) so the partner deduplicates it.
   */
  private async runExternalOperation(
    adapter: CoalitionAdapter,
    account: CoalitionAccountRow,
    tx: CoalitionTransactionRow,
  ): Promise<TxResult> {
    const metadata = (tx.metadata ?? {}) as Record<string, unknown>;
    if (isConvertTransaction(tx)) {
      if (!adapter.convert) throw new CoalitionUnsupportedError("convert", adapter.name);
      return adapter.convert(account.externalId, tx.amount, tx.localTxRef, tx.id);
    }
    if (tx.type === "EARN") {
      return adapter.accumulate(account.externalId, tx.amount, tx.localTxRef, metadata, tx.id);
    }
    if (!adapter.redeem) throw new CoalitionUnsupportedError("redeem", adapter.name);
    return adapter.redeem(account.externalId, tx.amount, tx.localTxRef, metadata);
  }

  /** Applies the local debit + credit of a convert, idempotently. */
  private async applyConvertLocalPoints(
    config: CoalitionConfigRow,
    account: CoalitionAccountRow,
    tx: CoalitionTransactionRow,
    externalTxId: string,
  ): Promise<void> {
    const coalitionPoints = Math.round(tx.amount * config.conversionRate);
    await this.pointsService.redeem({
      memberId: account.memberId,
      programId: account.programId,
      amount: tx.amount,
      source: `coalition:convert:${externalTxId}`,
      idempotencyKey: `local-debit-${tx.localTxRef}`,
    });
    await this.pointsService.earn({
      memberId: account.memberId,
      programId: account.programId,
      amount: coalitionPoints,
      source: `coalition:convert:${externalTxId}`,
      idempotencyKey: `local-credit-${tx.localTxRef}`,
      metadata: { coalitionTxId: externalTxId },
    });
  }

  /** Reverses a convert's external operation (best effort) after a local failure. */
  private async compensateConvert(
    adapter: CoalitionAdapter,
    tx: CoalitionTransactionRow,
    externalTxId: string,
    reason: string,
  ): Promise<void> {
    if (adapter.capabilities.reverseTransaction) {
      try {
        if (!adapter.reverseTransaction) {
          throw new CoalitionUnsupportedError("reverseTransaction", adapter.name);
        }
        await adapter.reverseTransaction(externalTxId, reason);
        await this.repo.updateTxReversed(tx.id, reason);
      } catch (reverseError) {
        console.error(
          `[Coalition] Compensation reversal failed for ${externalTxId}:`,
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
  }

  /** Searches the partner's history for the `[LOS:<txId>]` reference marker. */
  private async historyContainsTxReference(
    adapter: CoalitionAdapter,
    externalId: string,
    txId: string,
    from: Date,
    to: Date,
  ): Promise<boolean> {
    if (!adapter.capabilities.historyQuery || !adapter.queryHistory) return false;
    const entries = await adapter.queryHistory(externalId, from, to);
    const marker = `[LOS:${txId}]`;
    return entries.some((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const description = String(record.descripcion ?? record.description ?? "");
      return description.includes(marker);
    });
  }

  /** Records a NEEDS_REVIEW metric and an error log for alerting. */
  private alertNeedsReview(programId: string, provider: string, tx: CoalitionTransactionRow): void {
    this.metrics?.recordNeedsReview(provider);
    console.error(
      `[Coalition] NEEDS_REVIEW program=${programId} provider=${provider} tx=${tx.id} ` +
        `type=${tx.type} localTxRef=${tx.localTxRef} attempts=${String(tx.attempts)}`,
    );
  }
}

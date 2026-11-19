import crypto from "node:crypto";

import type { CoalitionAdapter, TxResult } from "../types.js";
import {
  CoalitionBusinessError,
  CoalitionDuplicateTsError,
  CoalitionTransientError,
} from "../types.js";
import {
  type ApprecioAccumulateResponse,
  type ApprecioBalanceResponse,
  type ApprecioConfig,
  ApprecioConfigError,
  type ApprecioHistoryResponse,
} from "./apprecio.types.js";

// ── Helpers ─────────────────────────────────────────────────────

function signMd5(ts: string, publicToken: string, privateToken: string): string {
  return crypto
    .createHash("md5")
    .update(ts + publicToken + privateToken)
    .digest("hex");
}

function buildFormData(
  accion: string,
  publicToken: string,
  ts: string,
  privateToken: string,
  extraParams: Record<string, string>,
): string {
  const hash = signMd5(ts, publicToken, privateToken);
  const params = new URLSearchParams({
    accion,
    public_token: publicToken,
    ts,
    hash,
    tipo: "JSON",
    ...extraParams,
  });
  return params.toString();
}

function validateIdentifier(identifierType: "email" | "rut", externalMemberRef: string): void {
  if (identifierType === "email" && !externalMemberRef.includes("@")) {
    throw new ApprecioConfigError(
      `identifierType is "email" but externalMemberRef "${externalMemberRef}" does not appear to be an email`,
    );
  }
}

// Apprecio does not document a precise descripcion length limit; truncate to a
// conservative bound while always preserving the "[LOS:<id>]" reference suffix.
const MAX_DESCRIPTION_LENGTH = 100;

/** Cryptographically-random alphanumeric code used as a unique `ts` per call. */
function randomAlphanumeric(length = 24): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    // crypto.randomInt is unbiased, unlike byte % chars.length which favors the
    // first few characters.
    out += chars.charAt(crypto.randomInt(chars.length));
  }
  return out;
}

/** Appends the LoyaltyOS transaction reference to a description, truncating the base if needed. */
function buildDescription(base: string, txId: string): string {
  const suffix = ` [LOS:${txId}]`;
  const maxBase = MAX_DESCRIPTION_LENGTH - suffix.length;
  const trimmed = base.length > maxBase ? `${base.slice(0, maxBase - 1)}…` : base;
  return trimmed + suffix;
}

/**
 * Detects an Apprecio rejection for a repeated `ts` (transaction id).
 *
 * TODO(#60): Apprecio does not document the exact JSON shape returned when a
 * `ts` is reused. The fixtures below are provisional — tighten them to the
 * observed field(s) once real sandbox/staging responses are captured.
 */
function isDuplicateTsResponse(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const body = json as {
    success?: unknown;
    message?: unknown;
    error?: unknown;
    code?: unknown;
    status?: unknown;
    data?: unknown;
  };

  const data = body.data as { duplicated?: unknown; duplicate?: unknown } | undefined;
  if (data?.duplicated === true || data?.duplicate === true) return true;

  const haystack = [body.message, body.error, body.code, body.status]
    .map((v) => String(v ?? ""))
    .join(" ")
    .toLowerCase();

  // Provisional fixtures (lower-cased).
  const fixtures = [
    "duplicat",
    "duplicado",
    "ya existe",
    "ya fue",
    "ya registrado",
    "ya aplicada",
    "ts repetido",
    "ts duplicado",
    "repeated ts",
    "transaccion duplicada",
    "carga duplicada",
    "duplicate transaction",
    "duplicate_ts",
    "ts_duplicado",
  ];

  return fixtures.some((f) => haystack.includes(f));
}

// ── Adapter ─────────────────────────────────────────────────────

export function createApprecioAdapter(config: ApprecioConfig): CoalitionAdapter {
  const {
    apiBase,
    publicToken,
    privateToken,
    identifierType,
    timeoutMs = 10000,
    description = "LoyaltyOS coalition transaction",
  } = config;

  // Apprecio is TLS-only; refuse a non-https base so TLS is always verified.
  if (!apiBase.startsWith("https://")) {
    throw new ApprecioConfigError("apiBase must use https:// so TLS is always verified");
  }

  async function callApi<T>(accion: string, extraParams: Record<string, string>): Promise<T> {
    // Never fall back to a wall-clock timestamp; every call must carry a unique
    // code (internal transaction id for loads, random alphanumeric otherwise).
    const ts = extraParams.ts ?? randomAlphanumeric();
    const body = buildFormData(accion, publicToken, ts, privateToken, extraParams);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = rawMessage.split(privateToken).join("[REDACTED]");
      throw new CoalitionTransientError(`Apprecio network error: ${safeMessage}`);
    }
    clearTimeout(timer);

    let json: T & { success?: boolean; message?: string; error?: string };
    try {
      json = (await response.json()) as T & {
        success?: boolean;
        message?: string;
        error?: string;
      };
    } catch {
      throw new CoalitionTransientError(
        `Apprecio returned non-JSON response (HTTP ${String(response.status)})`,
      );
    }

    // Sanitize API response detail so the private token never leaks through error messages,
    // even if the upstream API echoes it in an error response body.
    const safeDetail = (json.message ?? json.error ?? "unknown")
      .split(privateToken)
      .join("[REDACTED]");

    // A repeated `ts` means the operation was already applied upstream in a
    // prior call whose outcome we did not record. Surface it as a distinct
    // error so reconciliation can confirm against the partner's history instead
    // of treating it as a generic business failure.
    if (isDuplicateTsResponse(json)) {
      throw new CoalitionDuplicateTsError(`Apprecio duplicate ts rejected: ${safeDetail}`);
    }

    // Auth errors — no retry
    if (response.status === 401 || response.status === 403) {
      throw new CoalitionBusinessError(
        `Apprecio auth failed (HTTP ${String(response.status)}): ${safeDetail}`,
      );
    }

    // Server errors — transient, will retry
    if (response.status >= 500) {
      throw new CoalitionTransientError(
        `Apprecio server error (HTTP ${String(response.status)}): ${safeDetail}`,
      );
    }

    // Other client errors — business error, no retry
    if (response.status >= 400) {
      throw new CoalitionBusinessError(
        `Apprecio client error (HTTP ${String(response.status)}): ${safeDetail}`,
      );
    }

    // Business error indicated in response body (HTTP 2xx with error flag)
    if (json.success === false || json.error) {
      throw new CoalitionBusinessError(`Apprecio business error: ${safeDetail}`);
    }

    return json;
  }

  // ── Accumulate ──────────────────────────────────────────────

  async function accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
    internalTxId?: string,
  ): Promise<TxResult> {
    validateIdentifier(identifierType, externalMemberRef);
    const accion = identifierType === "email" ? "carga_directa_email" : "acumular_puntos";
    const refKey = identifierType === "email" ? "email" : "rut";
    // `ts` must be the internal CoalitionTransaction id (not the caller's txRef).
    const txId = internalTxId ?? txRef;

    const baseDescription =
      (metadata as Record<string, unknown> | null)?.description != null
        ? String((metadata as Record<string, unknown>).description)
        : description;

    const extraParams: Record<string, string> = {
      [refKey]: externalMemberRef,
      asignado: String(points),
      descripcion: buildDescription(baseDescription, txId),
      ts: txId,
    };

    const apiResponse = await callApi<ApprecioAccumulateResponse>(accion, extraParams);

    return {
      externalTxId: txRef,
      balanceAfter: apiResponse.data?.saldo_actual,
      raw: apiResponse,
    };
  }

  // ── Get Balance ─────────────────────────────────────────────

  async function getBalance(externalMemberRef: string): Promise<number> {
    validateIdentifier(identifierType, externalMemberRef);
    const accion = identifierType === "email" ? "saldo_usuario_email" : "saldo_usuario";
    const refKey = identifierType === "email" ? "email" : "rut";

    const extraParams: Record<string, string> = {
      [refKey]: externalMemberRef,
      ts: randomAlphanumeric(),
    };

    const apiResponse = await callApi<ApprecioBalanceResponse>(accion, extraParams);

    return apiResponse.data?.saldo ?? 0;
  }

  // ── Healthcheck ─────────────────────────────────────────────

  async function healthcheck(): Promise<{
    ok: boolean;
    latencyMs?: number;
    details?: unknown;
  }> {
    const startedAt = Date.now();
    try {
      // Use a lightweight balance check against a known-non-existent user
      // to verify connectivity and auth.
      const accion = identifierType === "email" ? "saldo_usuario_email" : "saldo_usuario";
      const refKey = identifierType === "email" ? "email" : "rut";
      const extraParams: Record<string, string> = {
        [refKey]: identifierType === "email" ? "healthcheck@loyaltyos.dev" : "00000000-0",
        ts: randomAlphanumeric(),
      };
      await callApi(accion, extraParams);
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Query History ───────────────────────────────────────────

  async function queryHistory(externalMemberRef: string, from: Date, to: Date): Promise<unknown[]> {
    validateIdentifier(identifierType, externalMemberRef);

    function fmtDate(d: Date): string {
      return d.toISOString().slice(0, 10);
    }

    const extraParams: Record<string, string> = {
      date_start: fmtDate(from),
      date_end: fmtDate(to),
      ts: randomAlphanumeric(),
    };

    const apiResponse = await callApi<ApprecioHistoryResponse>("historialCarga", extraParams);

    return apiResponse.data ?? [];
  }

  // ── Adapter object ──────────────────────────────────────────

  return {
    name: "apprecio",
    timeoutMs,
    capabilities: {
      accumulate: true,
      redeem: false,
      convert: true,
      reverseTransaction: false,
      historyQuery: true,
    },
    healthcheck,
    getBalance,
    accumulate,
    redeem: undefined, // not supported — capability check will block before invocation
    convert: async (
      externalMemberRef: string,
      ownPoints: number,
      txRef: string,
      internalTxId?: string,
    ): Promise<TxResult> => {
      // convert maps to accumulate since Apprecio only receives points.
      // The CoalitionService handles local points debit internally.
      return accumulate(externalMemberRef, ownPoints, txRef, undefined, internalTxId);
    },
    reverseTransaction: undefined, // not supported
    queryHistory,
  };
}

import crypto from "node:crypto";

import type { CoalitionAdapter, TxResult } from "../types.js";
import { CoalitionBusinessError, CoalitionTransientError } from "../types.js";
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

  async function callApi<T>(accion: string, extraParams: Record<string, string>): Promise<T> {
    const ts = extraParams.ts ?? String(Math.floor(Date.now() / 1000));
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
      const message = err instanceof Error ? err.message : String(err);
      throw new CoalitionTransientError(`Apprecio network error: ${message}`);
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

    // Auth errors — no retry
    if (response.status === 401 || response.status === 403) {
      throw new CoalitionBusinessError(
        `Apprecio auth failed (HTTP ${String(response.status)}): ${json.message ?? json.error ?? "unknown"}`,
      );
    }

    // Server errors — transient, will retry
    if (response.status >= 500) {
      throw new CoalitionTransientError(
        `Apprecio server error (HTTP ${String(response.status)}): ${json.message ?? json.error ?? "unknown"}`,
      );
    }

    // Other client errors — business error, no retry
    if (response.status >= 400) {
      throw new CoalitionBusinessError(
        `Apprecio client error (HTTP ${String(response.status)}): ${json.message ?? json.error ?? "unknown"}`,
      );
    }

    // Business error indicated in response body (HTTP 2xx with error flag)
    if (json.success === false || json.error) {
      throw new CoalitionBusinessError(
        `Apprecio business error: ${json.message ?? json.error ?? "unknown"}`,
      );
    }

    return json;
  }

  // ── Accumulate ──────────────────────────────────────────────

  async function accumulate(
    externalMemberRef: string,
    points: number,
    txRef: string,
    metadata?: object,
  ): Promise<TxResult> {
    validateIdentifier(identifierType, externalMemberRef);
    const accion = identifierType === "email" ? "carga_directa_email" : "acumular_puntos";
    const refKey = identifierType === "email" ? "email" : "rut";

    const extraParams: Record<string, string> = {
      [refKey]: externalMemberRef,
      asignado: String(points),
      descripcion:
        (metadata as Record<string, unknown> | null)?.description != null
          ? String((metadata as Record<string, unknown>).description)
          : description,
      ts: txRef,
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
      ts: String(Math.floor(Date.now() / 1000)),
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
        ts: String(Math.floor(Date.now() / 1000)),
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
      ts: String(Math.floor(Date.now() / 1000)),
    };

    const apiResponse = await callApi<ApprecioHistoryResponse>("historialCarga", extraParams);

    return apiResponse.data ?? [];
  }

  // ── Adapter object ──────────────────────────────────────────

  return {
    name: "apprecio",
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
    ): Promise<TxResult> => {
      // convert maps to accumulate since Apprecio only receives points.
      // The CoalitionService handles local points debit internally.
      return accumulate(externalMemberRef, ownPoints, txRef);
    },
    reverseTransaction: undefined, // not supported
    queryHistory,
  };
}

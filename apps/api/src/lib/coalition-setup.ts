import { CoalitionService, createApprecioAdapter } from "@loyaltyos/coalition";

import { prisma } from "../db.js";
import { adaptCoalitionMetrics, getBusinessMetrics } from "./business-metrics.js";
import { getRedisCache } from "./redis-cache.js";

export const coalitionService = new CoalitionService(
  prisma,
  adaptCoalitionMetrics(getBusinessMetrics()),
);

// ── Apprecio Adapter ──────────────────────────────────────────────

/**
 * Registers the deprecated APPRECIO_* env adapter as a fallback. It is only
 * usable when the installation has exactly one program: with more than one, a
 * program without a CoalitionConfig is an error and each program must be
 * configured explicitly (admin → Coalition).
 */
export async function setupApprecioFallback(): Promise<void> {
  const apprecioApiBase = process.env.APPRECIO_API_BASE;
  const apprecioPublicToken = process.env.APPRECIO_PUBLIC_TOKEN;
  const apprecioPrivateToken = process.env.APPRECIO_PRIVATE_TOKEN;

  if (!apprecioApiBase || !apprecioPublicToken || !apprecioPrivateToken) {
    return;
  }

  const programCount = await prisma.program.count();

  if (programCount > 1) {
    console.warn(
      `[Coalition] APPRECIO_* env vars are ignored: this installation has ${String(programCount)} ` +
        "programs. Configure Apprecio credentials per program (admin → Coalition); each " +
        "program requires its own CoalitionConfig.",
    );
    return;
  }

  console.warn(
    "[Coalition] APPRECIO_* env vars are deprecated — configure Apprecio credentials " +
      "per program (admin → Coalition). They only apply as a fallback for a " +
      "single-program install with no CoalitionConfig.",
  );

  const apprecioIdentifierType: "email" | "rut" =
    process.env.APPRECIO_IDENTIFIER_TYPE === "rut" ? "rut" : "email";
  const apprecioTimeoutMs = process.env.APPRECIO_TIMEOUT_MS
    ? parseInt(process.env.APPRECIO_TIMEOUT_MS, 10)
    : 10000;

  const apprecioAdapter = createApprecioAdapter({
    apiBase: apprecioApiBase,
    publicToken: apprecioPublicToken,
    privateToken: apprecioPrivateToken,
    identifierType: apprecioIdentifierType,
    timeoutMs: apprecioTimeoutMs,
  });
  coalitionService.registerAdapter(apprecioAdapter, "apprecio:env");
}

// ── Balance Cache ─────────────────────────────────────────────────
// Wraps adapter.getBalance with a short Redis cache (TTL 60 s).

const cache = getRedisCache();
const BALANCE_CACHE_TTL_S = 60;

function balanceCacheKey(programId: string, externalMemberRef: string): string {
  return `coalition:balance:${programId}:${externalMemberRef}`;
}

export async function getCachedExternalBalance(
  programId: string,
  externalMemberRef: string,
  fetchFresh: () => Promise<number>,
): Promise<number> {
  if (!cache) return fetchFresh();

  const key = balanceCacheKey(programId, externalMemberRef);
  const cached = await cache.get(key);
  if (cached !== null) {
    return Number(cached);
  }

  const balance = await fetchFresh();
  await cache.set(key, String(balance), "EX", BALANCE_CACHE_TTL_S);
  return balance;
}

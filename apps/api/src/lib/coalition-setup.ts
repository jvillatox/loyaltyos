import { CoalitionService, createApprecioAdapter } from "@loyaltyos/coalition";

import { prisma } from "../db.js";
import { getRedisCache } from "./redis-cache.js";

export const coalitionService = new CoalitionService(prisma);

// ── Apprecio Adapter ──────────────────────────────────────────────

const apprecioApiBase = process.env.APPRECIO_API_BASE;
const apprecioPublicToken = process.env.APPRECIO_PUBLIC_TOKEN;
const apprecioPrivateToken = process.env.APPRECIO_PRIVATE_TOKEN;
const apprecioIdentifierType: "email" | "rut" =
  process.env.APPRECIO_IDENTIFIER_TYPE === "rut" ? "rut" : "email";
const apprecioTimeoutMs = process.env.APPRECIO_TIMEOUT_MS
  ? parseInt(process.env.APPRECIO_TIMEOUT_MS, 10)
  : 10000;

if (apprecioApiBase && apprecioPublicToken && apprecioPrivateToken) {
  const apprecioAdapter = createApprecioAdapter({
    apiBase: apprecioApiBase,
    publicToken: apprecioPublicToken,
    privateToken: apprecioPrivateToken,
    identifierType: apprecioIdentifierType,
    timeoutMs: apprecioTimeoutMs,
  });
  coalitionService.registerAdapter(apprecioAdapter);
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

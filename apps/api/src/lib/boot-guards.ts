import { MIN_MASTER_KEY_LENGTH } from "@loyaltyos/coalition";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";

export const DEFAULT_DEV_API_KEY = "dev-key";

// Boot-time guard: in production, refuse to start while the master encryption key
// is missing or too short. Coalition credentials are encrypted with this key, so a
// weak or absent key means they cannot be decrypted (or were encrypted with the
// publicly-known development fallback).
export function assertMasterKeyConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;

  const key = process.env.KMS_MASTER_KEY;
  if (!key || key.length < MIN_MASTER_KEY_LENGTH) {
    throw new Error(
      `Refusing to start in production: KMS_MASTER_KEY is ${
        key ? `too short (${String(key.length)} characters)` : "not set"
      }. ` +
        `Set KMS_MASTER_KEY to at least ${String(MIN_MASTER_KEY_LENGTH)} characters. ` +
        "If coalition credentials were encrypted with the development fallback key, run " +
        "`pnpm --filter @loyaltyos/api coalition:reencrypt --from-key <old-key>` to migrate them.",
    );
  }
}

// Boot-time guard: in production, refuse to start while the seeded "dev-key"
// API key is still active. The admin UI now authenticates exclusively with the
// session cookie, and a well-known SERVER-scope key is an obvious target.
export async function assertNoDefaultApiKey(
  db: Pick<PrismaClient, "apiKey"> = prisma,
): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const existing = await db.apiKey.findFirst({
    where: { key: DEFAULT_DEV_API_KEY, isActive: true },
  });

  if (existing) {
    throw new Error(
      `Refusing to start in production: the API key "${DEFAULT_DEV_API_KEY}" is still active. ` +
        "Delete or rotate it before deploying — this key is only intended for local development.",
    );
  }
}

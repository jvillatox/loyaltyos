import type { PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";

export const DEFAULT_DEV_API_KEY = "dev-key";

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

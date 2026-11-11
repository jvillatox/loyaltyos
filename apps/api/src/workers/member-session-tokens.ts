import { prisma } from "../db.js";
import { createWorker } from "../lib/queue.js";

/** Delete tokens that have been dead (revoked or expired) for more than 24h. */
export async function cleanupExpiredMemberTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.memberSessionToken.deleteMany({
    where: {
      OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
  });
  return count;
}

export function startMemberTokenCleanupWorker(): void {
  createWorker("member-session-tokens.cleanup", async () => {
    const count = await cleanupExpiredMemberTokens();
    console.log(`[Worker] Member session token cleanup: ${String(count)} tokens deleted`);
  });

  console.log("[Worker] Member session token cleanup worker started");
}

import { createQueue } from "./queue.js";

// Daily cleanup of expired/revoked member session tokens.
const cleanupQueue = createQueue("member-session-tokens.cleanup");

export async function scheduleMemberTokenCleanup(): Promise<void> {
  await cleanupQueue.add(
    "daily-cleanup",
    {},
    {
      repeat: { pattern: "0 4 * * *" },
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
}

export { cleanupQueue };

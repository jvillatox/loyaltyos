import crypto from "node:crypto";

import type { Redis } from "ioredis";

export interface LockResult {
  acquired: boolean;
  release: () => Promise<void>;
}

export type RedisLockFn = (key: string, ttlSeconds: number) => Promise<LockResult>;

const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

export function createRedisLocks(redis: Redis): RedisLockFn {
  return async (key: string, ttlSeconds: number): Promise<LockResult> => {
    const lockKey = `giftcard:lock:${key}`;
    const token = crypto.randomBytes(16).toString("hex");
    const result = await redis.set(lockKey, token, "EX", ttlSeconds, "NX");
    const acquired = result === "OK";

    return {
      acquired,
      release: async () => {
        if (acquired) {
          await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
        }
      },
    };
  };
}

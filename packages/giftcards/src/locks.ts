import type { Redis } from "ioredis";

export interface LockResult {
  acquired: boolean;
  release: () => Promise<void>;
}

export type RedisLockFn = (key: string, ttlSeconds: number) => Promise<LockResult>;

export function createRedisLocks(redis: Redis): RedisLockFn {
  return async (key: string, ttlSeconds: number): Promise<LockResult> => {
    const lockKey = `giftcard:lock:${key}`;
    const result = await redis.set(lockKey, "1", "EX", ttlSeconds, "NX");
    const acquired = result === "OK";
    return {
      acquired,
      release: async () => {
        if (acquired) {
          await redis.del(lockKey);
        }
      },
    };
  };
}

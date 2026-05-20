import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let cache: Redis | null | undefined;

export function getRedisCache(): Redis | null {
  if (cache !== undefined) return cache;
  try {
    cache = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    return cache;
  } catch {
    cache = null;
    return null;
  }
}

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertNoDefaultApiKey } from "../lib/boot-guards.js";

function mockDb(result: unknown): Pick<PrismaClient, "apiKey"> {
  return {
    apiKey: {
      findFirst: vi.fn().mockResolvedValue(result),
    },
  } as unknown as Pick<PrismaClient, "apiKey">;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertNoDefaultApiKey", () => {
  it("throws in production when an active dev-key exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = mockDb({ id: "key-1", key: "dev-key", isActive: true });

    await expect(assertNoDefaultApiKey(db)).rejects.toThrow(/dev-key/);
  });

  it("does not throw in production when no active dev-key exists", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = mockDb(null);

    await expect(assertNoDefaultApiKey(db)).resolves.toBeUndefined();
  });

  it("does not throw outside production even with a dev-key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const db = mockDb({ id: "key-1", key: "dev-key", isActive: true });

    await expect(assertNoDefaultApiKey(db)).resolves.toBeUndefined();
    expect(db.apiKey.findFirst).not.toHaveBeenCalled();
  });
});

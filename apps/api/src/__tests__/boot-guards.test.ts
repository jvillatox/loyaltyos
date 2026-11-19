import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertMasterKeyConfigured, assertNoDefaultApiKey } from "../lib/boot-guards.js";

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

describe("assertMasterKeyConfigured", () => {
  it("throws in production when KMS_MASTER_KEY is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KMS_MASTER_KEY", undefined);

    expect(() => assertMasterKeyConfigured()).toThrow(/KMS_MASTER_KEY/);
  });

  it("throws in production when KMS_MASTER_KEY is shorter than 32 characters", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KMS_MASTER_KEY", "too-short");

    expect(() => assertMasterKeyConfigured()).toThrow(/KMS_MASTER_KEY/);
  });

  it("does not throw in production with a 32+ character key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KMS_MASTER_KEY", "x".repeat(32));

    expect(() => assertMasterKeyConfigured()).not.toThrow();
  });

  it("does not throw outside production when KMS_MASTER_KEY is missing", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KMS_MASTER_KEY", undefined);

    expect(() => assertMasterKeyConfigured()).not.toThrow();
  });
});

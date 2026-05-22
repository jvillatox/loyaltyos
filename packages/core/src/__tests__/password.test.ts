import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../auth/password.js";

describe("hashPassword", () => {
  it("produces an argon2id hash string", async () => {
    const hash = await hashPassword("test123");
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("produces different hashes for the same password", async () => {
    const a = await hashPassword("admin123");
    const b = await hashPassword("admin123");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("returns true for correct password", async () => {
    const hash = await hashPassword("correct-horse");
    const valid = await verifyPassword(hash, "correct-horse");
    expect(valid).toBe(true);
  });

  it("returns false for incorrect password", async () => {
    const hash = await hashPassword("correct-horse");
    const valid = await verifyPassword(hash, "wrong-password");
    expect(valid).toBe(false);
  });

  it("returns false for malformed hash", async () => {
    const valid = await verifyPassword("not-a-real-hash", "anything");
    expect(valid).toBe(false);
  });
});

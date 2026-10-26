import { adminRoleRank, minAdminRole } from "@loyaltyos/permissions";
import { describe, expect, it } from "vitest";

import {
  generateToken,
  hashToken,
  MAX_TOKEN_DAYS,
  PAT_PREFIX,
} from "../lib/personal-access-token.js";

describe("personal access token generation", () => {
  it("generates a token with the lopat_ prefix and a substantial secret", () => {
    const { token } = generateToken();
    expect(token.startsWith(PAT_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(PAT_PREFIX.length + 16);
  });

  it("hashes the full token to a 64-char sha256 hex digest", () => {
    const { token, tokenHash } = generateToken();
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prefix is the first 8 characters of the secret portion", () => {
    const { token, prefix } = generateToken();
    const secret = token.slice(PAT_PREFIX.length);
    expect(prefix).toHaveLength(8);
    expect(secret.slice(0, 8)).toBe(prefix);
  });

  it("produces unique, random tokens", () => {
    const a = generateToken().token;
    const b = generateToken().token;
    expect(a).not.toBe(b);
  });

  it("caps token lifetime at 90 days", () => {
    expect(MAX_TOKEN_DAYS).toBe(90);
  });
});

describe("role ranking", () => {
  it("orders ANALYST < OPERATOR < SUPER_ADMIN", () => {
    expect(adminRoleRank("ANALYST")).toBeLessThan(adminRoleRank("OPERATOR"));
    expect(adminRoleRank("OPERATOR")).toBeLessThan(adminRoleRank("SUPER_ADMIN"));
  });

  it("minAdminRole returns the least-privileged of two roles", () => {
    expect(minAdminRole("SUPER_ADMIN", "ANALYST")).toBe("ANALYST");
    expect(minAdminRole("ANALYST", "SUPER_ADMIN")).toBe("ANALYST");
    expect(minAdminRole("OPERATOR", "OPERATOR")).toBe("OPERATOR");
    expect(minAdminRole("OPERATOR", "SUPER_ADMIN")).toBe("OPERATOR");
  });
});

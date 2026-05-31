import { describe, expect, it } from "vitest";

import { ALPHABET, formatCode, generateCode, normalizeCode, validateChecksum } from "../code.js";

describe("generateCode", () => {
  it("generates a 16-character dashless code", () => {
    const code = generateCode();
    expect(code).toHaveLength(16);
    expect(code).not.toContain("-");
  });

  it("uses only characters from the alphabet", () => {
    const code = generateCode();
    for (const ch of code) {
      expect(ALPHABET).toContain(ch);
    }
  });

  it("generates codes that pass checksum validation", () => {
    const secret = "test-secret";
    for (let i = 0; i < 100; i++) {
      const code = generateCode(undefined, secret);
      expect(validateChecksum(code, secret)).toBe(true);
    }
  });

  it("prepends a prefix when given", () => {
    const code = generateCode("VIP", "secret");
    expect(code.startsWith("VIP")).toBe(true);
    // prefix + 12 body + 4 checksum = prefix.length + 16
    expect(code).toHaveLength(3 + 16);
  });

  it("generates 10,000 unique codes with no duplicates", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      codes.add(generateCode());
    }
    expect(codes.size).toBe(10_000);
  });
});

describe("validateChecksum", () => {
  it("returns true for a valid code", () => {
    const secret = "test-secret";
    const code = generateCode(undefined, secret);
    expect(validateChecksum(code, secret)).toBe(true);
  });

  it("returns false for a tampered code", () => {
    const secret = "test-secret";
    const code = generateCode(undefined, secret);
    // Tamper with the body (before checksum)
    const chars = code.split("");
    const bodyChar = chars[3];
    chars[3] = bodyChar === "A" ? "B" : "A";
    expect(validateChecksum(chars.join(""), secret)).toBe(false);
  });

  it("returns false for a completely random string", () => {
    expect(validateChecksum("ABCDEFGHJKLMNPQR", "secret")).toBe(false);
  });

  it("returns false with a different secret", () => {
    const code = generateCode(undefined, "secret-a");
    expect(validateChecksum(code, "secret-b")).toBe(false);
  });
});

describe("normalizeCode", () => {
  it("converts to uppercase", () => {
    expect(normalizeCode("abc-def-ghjk")).toBe("ABCDEFGHJK");
  });

  it("strips dashes", () => {
    expect(normalizeCode("ABCD-EFGH-JKLM-NPQR")).toBe("ABCDEFGHJKLMNPQR");
  });

  it("strips whitespace", () => {
    expect(normalizeCode("  ABCD EFGH JKLM NPQR  ")).toBe("ABCDEFGHJKLMNPQR");
  });

  it("handles mixed input", () => {
    expect(normalizeCode("  abc-def-ghjk Lmnp  ")).toBe("ABCDEFGHJKLMNP");
  });
});

describe("formatCode", () => {
  it("inserts dashes every 4 characters", () => {
    expect(formatCode("ABCDEFGHJKLMNPQR")).toBe("ABCD-EFGH-JKLM-NPQR");
  });

  it("returns the input unchanged if fewer than 4 characters", () => {
    expect(formatCode("ABC")).toBe("ABC");
  });
});

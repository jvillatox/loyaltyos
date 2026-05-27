import { describe, expect, it } from "vitest";

import { isSupportedLocale, resolveLocale } from "../detect.js";

describe("isSupportedLocale", () => {
  it("returns true for es-MX", () => {
    expect(isSupportedLocale("es-MX")).toBe(true);
  });

  it("returns true for en-US", () => {
    expect(isSupportedLocale("en-US")).toBe(true);
  });

  it("returns false for unsupported locale", () => {
    expect(isSupportedLocale("fr-FR")).toBe(false);
  });
});

describe("resolveLocale", () => {
  it("returns userPreference first", () => {
    expect(
      resolveLocale({
        userPreference: "en-US",
        browserLanguage: "es-MX",
      }),
    ).toBe("en-US");
  });

  it("falls back to browserLanguage", () => {
    expect(
      resolveLocale({
        browserLanguage: "en-US",
      }),
    ).toBe("en-US");
  });

  it("falls back to acceptLanguage", () => {
    expect(
      resolveLocale({
        acceptLanguage: "en-US",
      }),
    ).toBe("en-US");
  });

  it("falls back to programDefault", () => {
    expect(
      resolveLocale({
        programDefault: "en-US",
      }),
    ).toBe("en-US");
  });

  it("defaults to es-MX when nothing matches", () => {
    expect(resolveLocale({})).toBe("es-MX");
  });

  it("matches language-only prefix", () => {
    expect(
      resolveLocale({
        browserLanguage: "es",
      }),
    ).toBe("es-MX");
  });

  it("matches en prefix to en-US", () => {
    expect(
      resolveLocale({
        browserLanguage: "en",
      }),
    ).toBe("en-US");
  });

  it("respects resolution order", () => {
    expect(
      resolveLocale({
        acceptLanguage: "en-US",
        userPreference: "es-MX",
        browserLanguage: "en-US",
      }),
    ).toBe("es-MX");
  });
});

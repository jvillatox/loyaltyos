import { describe, expect, it } from "vitest";

import { initCatalog, t } from "../catalog.js";

describe("catalog", () => {
  it("translates a top-level key", async () => {
    await initCatalog("es-MX");
    const result = t("members.title");
    expect(result).toBe("Miembros");
  });

  it("translates a nested key", async () => {
    await initCatalog("es-MX");
    const result = t("members.tiers.gold");
    expect(result).toBe("Oro");
  });

  it("translates with parameter interpolation", async () => {
    await initCatalog("en-US");
    const result = t("common.pageInfo", { page: 1, totalPages: 5, total: 100 });
    expect(result).toBe("Page 1 of 5 (100 total)");
  });

  it("returns correct translation in en-US", async () => {
    await initCatalog("en-US");
    const result = t("members.tiers.gold");
    expect(result).toBe("Gold");
  });

  it("returns the key for completely nonexistent key", async () => {
    await initCatalog("es-MX");
    const result = t("nonexistent.key");
    // Should return the key itself as fallback
    expect(result).toBe("nonexistent.key");
  });
});

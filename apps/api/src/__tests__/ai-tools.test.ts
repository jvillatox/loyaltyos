import { buildTools } from "@loyaltyos/ai";
import { describe, expect, it, vi } from "vitest";

import { MUTATION_TOOLS, READ_ONLY_TOOLS } from "../routes/admin/ai.js";

describe("AI tool categorization", () => {
  const tools = buildTools({
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
    baseUrl: "http://localhost:3002/api/v1",
  });

  it("classifies every tool as either read-only or mutation", () => {
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const isReadOnly = READ_ONLY_TOOLS.has(name);
      const isMutation = MUTATION_TOOLS.has(name);
      expect(
        isReadOnly !== isMutation,
        `tool "${name}" must be in exactly one of READ_ONLY_TOOLS / MUTATION_TOOLS`,
      ).toBe(true);
    }
  });

  it("does not list stale categories (every category name is a real tool)", () => {
    const names = new Set(tools.map((t) => t.name));

    for (const name of READ_ONLY_TOOLS) {
      expect(names.has(name), `READ_ONLY_TOOLS contains unknown tool "${name}"`).toBe(true);
    }
    for (const name of MUTATION_TOOLS) {
      expect(names.has(name), `MUTATION_TOOLS contains unknown tool "${name}"`).toBe(true);
    }
  });
});

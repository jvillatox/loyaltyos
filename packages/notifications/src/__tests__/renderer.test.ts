import { describe, expect, it } from "vitest";

import { render } from "../renderer.js";

describe("renderer — defense in depth", () => {
  it("blocks constructor access via template variable", () => {
    const result = render("{{constructor}}", { name: "x" });
    // Must not leak the Object constructor function or its string form
    expect(result).not.toContain("function Object()");
    expect(result).not.toContain("[native code]");
  });

  it("blocks constructor access via lookup helper", () => {
    const result = render("{{lookup this 'constructor'}}", { name: "x" });
    expect(result).not.toContain("function Object()");
    expect(result).not.toContain("[native code]");
  });

  it("sanitizes arrays with poisoned prototype", () => {
    const context = {
      items: [{ __proto__: { evil: 1 }, name: "ok" }],
    };
    const result = render("{{#each items}}{{name}}{{/each}}", context);
    expect(result).toBe("ok");
    expect(result).not.toContain("evil");
  });

  it("renders normal templates correctly", () => {
    const result = render("Hello, {{name}}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("renders each loops over arrays", () => {
    const result = render("{{#each items}}{{this}},{{/each}}", { items: ["a", "b"] });
    expect(result).toBe("a,b,");
  });
});

import { describe, expect, it } from "vitest";

import { ProgramConfigGetSchema, WebhooksListSchema } from "../tools/program.js";

describe("ProgramConfigGetSchema", () => {
  it("accepts empty object", () => {
    const result = ProgramConfigGetSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("WebhooksListSchema", () => {
  it("accepts empty object", () => {
    const result = WebhooksListSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Duplicated from batch-wizard.tsx to keep tests isolated
const wizardSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  prefix: z
    .string()
    .max(8)
    .regex(/^[A-Z0-9]*$/, "Only uppercase letters and numbers")
    .optional()
    .or(z.literal("")),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  initialAmount: z.coerce.number().positive("Amount must be greater than 0"),
  currency: z.string().length(3).default("MXN"),
  expirationDate: z.date().optional(),
  termsTemplateId: z.string().min(1, "Select a terms template"),
});

type WizardData = z.infer<typeof wizardSchema>;

function makeValid(): WizardData {
  return {
    name: "Test Batch",
    prefix: "TEST",
    quantity: 100,
    initialAmount: 500,
    currency: "MXN",
    expirationDate: new Date(Date.now() + 86400000),
    termsTemplateId: "tpl_123",
  };
}

describe("BatchWizard schema", () => {
  it("accepts a valid payload", () => {
    const result = wizardSchema.safeParse(makeValid());
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 200 chars", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), name: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects quantity of 0", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), quantity: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects quantity over 1M", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), quantity: 1_000_001 });
    expect(result.success).toBe(false);
  });

  it("rejects negative initial amount", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), initialAmount: -10 });
    expect(result.success).toBe(false);
  });

  it("rejects zero initial amount", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), initialAmount: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts empty prefix (converts to empty string)", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), prefix: "" });
    expect(result.success).toBe(true);
  });

  it("accepts undefined prefix", () => {
    const { prefix: _, ...rest } = makeValid();
    const result = wizardSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects lowercase prefix", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), prefix: "abc" });
    expect(result.success).toBe(false);
  });

  it("accepts uppercase alphanumeric prefix", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), prefix: "HOLIDAY" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid currency length", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), currency: "US" });
    expect(result.success).toBe(false);
  });

  it("rejects empty termsTemplateId", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), termsTemplateId: "" });
    expect(result.success).toBe(false);
  });

  it("defaults currency to MXN when omitted", () => {
    const { currency: _, ...rest } = makeValid();
    const result = wizardSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("MXN");
    }
  });

  it("coerces string quantity to number", () => {
    const result = wizardSchema.safeParse({ ...makeValid(), quantity: "500" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(500);
    }
  });
});

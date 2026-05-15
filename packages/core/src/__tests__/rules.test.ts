import type { PointRule } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { calculateEffectiveAmount, evaluateRules } from "../rules.js";

const makeRule = (overrides: Partial<PointRule> = {}): PointRule =>
  ({
    id: "rule-1",
    programId: "prog-1",
    eventType: "purchase",
    multiplier: 2.0,
    conditions: {},
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as PointRule;

describe("evaluateRules", () => {
  it("returns 1.0 multiplier with no rules", () => {
    const result = evaluateRules([]);
    expect(result.multiplier).toBe(1.0);
    expect(result.matchedRules).toEqual([]);
  });

  it("applies a single matching rule", () => {
    const rule = makeRule({ multiplier: 2.0, conditions: { category: "electronics" } });
    const result = evaluateRules([rule], { category: "electronics" });
    expect(result.multiplier).toBe(2.0);
    expect(result.matchedRules).toEqual(["rule-1"]);
  });

  it("multiplies multiple matching rules", () => {
    const rules = [
      makeRule({ id: "r1", multiplier: 2.0, conditions: { channel: "online" } }),
      makeRule({ id: "r2", multiplier: 3.0, conditions: { category: "premium" } }),
    ];
    const result = evaluateRules(rules, { channel: "online", category: "premium" });
    expect(result.multiplier).toBe(6.0);
  });

  it("ignores rules that don't match conditions", () => {
    const rules = [
      makeRule({ id: "r1", multiplier: 2.0, conditions: { category: "electronics" } }),
      makeRule({ id: "r2", multiplier: 3.0, conditions: { category: "sports" } }),
    ];
    const result = evaluateRules(rules, { category: "electronics" });
    expect(result.multiplier).toBe(2.0);
    expect(result.matchedRules).toEqual(["r1"]);
  });

  it("matches using $gte operator", () => {
    const rule = makeRule({
      multiplier: 2.0,
      conditions: { amount: { $gte: 1000 } },
    });
    const result = evaluateRules([rule], { amount: 1500 });
    expect(result.multiplier).toBe(2.0);
  });

  it("rejects when $gte operator is not satisfied", () => {
    const rule = makeRule({
      multiplier: 2.0,
      conditions: { amount: { $gte: 1000 } },
    });
    const result = evaluateRules([rule], { amount: 500 });
    expect(result.multiplier).toBe(1.0);
  });

  it("matches using $lte operator", () => {
    const rule = makeRule({
      multiplier: 1.5,
      conditions: { amount: { $lte: 500 } },
    });
    const result = evaluateRules([rule], { amount: 300 });
    expect(result.multiplier).toBe(1.5);
  });

  it("returns 1.0 when payload is missing required key", () => {
    const rule = makeRule({ multiplier: 2.0, conditions: { category: "sports" } });
    const result = evaluateRules([rule], { amount: 100 });
    expect(result.multiplier).toBe(1.0);
  });

  it("returns 1.0 when conditions are present but payload is undefined", () => {
    const rule = makeRule({ multiplier: 2.0, conditions: { foo: "bar" } });
    const result = evaluateRules([rule]);
    expect(result.multiplier).toBe(1.0);
  });

  it("matches on $eq operator", () => {
    const rule = makeRule({
      multiplier: 3.0,
      conditions: { region: { $eq: "west" } },
    });
    const result = evaluateRules([rule], { region: "west" });
    expect(result.multiplier).toBe(3.0);
  });
});

describe("calculateEffectiveAmount", () => {
  it("applies multiplier and floors the result", () => {
    const result = calculateEffectiveAmount(100, 2.0);
    expect(result).toEqual({ base: 100, multiplier: 2.0, total: 200 });
  });

  it("floors fractional points", () => {
    const result = calculateEffectiveAmount(33, 1.5);
    expect(result.total).toBe(49);
  });

  it("returns base amount when multiplier is 1.0", () => {
    const result = calculateEffectiveAmount(500, 1.0);
    expect(result.total).toBe(500);
  });
});

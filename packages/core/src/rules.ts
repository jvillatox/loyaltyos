import type { PointRule } from "@prisma/client";

interface RuleEvaluation {
  multiplier: number;
  matchedRules: string[];
}

export function evaluateRules(
  rules: PointRule[],
  eventPayload?: Record<string, unknown>,
): RuleEvaluation {
  if (rules.length === 0) {
    return { multiplier: 1.0, matchedRules: [] };
  }

  let combinedMultiplier = 1.0;
  const matchedRules: string[] = [];

  for (const rule of rules) {
    if (matchesConditions(rule.conditions as Record<string, unknown> | null, eventPayload)) {
      combinedMultiplier *= rule.multiplier;
      matchedRules.push(rule.id);
    }
  }

  return { multiplier: combinedMultiplier, matchedRules };
}

function matchesConditions(
  conditions: Record<string, unknown> | null,
  payload?: Record<string, unknown>,
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }
  if (!payload) {
    return false;
  }

  for (const [key, expected] of Object.entries(conditions)) {
    const actual = payload[key];
    if (actual === undefined) {
      return false;
    }
    if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
      const op = expected as Record<string, unknown>;
      // Check if it's an operator object
      if ("$gte" in op || "$lte" in op || "$eq" in op) {
        const numActual = Number(actual);
        if (op.$gte !== undefined && numActual < (op.$gte as number)) return false;
        if (op.$lte !== undefined && numActual > (op.$lte as number)) return false;
        if (op.$eq !== undefined && actual !== op.$eq) return false;
      } else if (actual !== expected) {
        return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }

  return true;
}

export function calculateEffectiveAmount(
  baseAmount: number,
  multiplier: number,
): { base: number; multiplier: number; total: number } {
  const total = Math.floor(baseAmount * multiplier);
  return { base: baseAmount, multiplier, total };
}

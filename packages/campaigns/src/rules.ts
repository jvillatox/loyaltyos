interface RuleCondition {
  field: string;
  eq?: unknown;
  neq?: unknown;
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
  in?: unknown[];
  between?: [number, number];
  contains?: string;
}

interface RuleGroup {
  all?: (RuleCondition | RuleGroup)[];
  any?: (RuleCondition | RuleGroup)[];
}

export function evaluateRules(
  rules: Record<string, unknown> | null,
  context: Record<string, unknown>,
): boolean {
  if (!rules || Object.keys(rules).length === 0) {
    return true;
  }
  return matchesGroup(rules as unknown as RuleGroup, context);
}

function matchesGroup(group: RuleGroup, context: Record<string, unknown>): boolean {
  let result = true;

  if (group.all && group.all.length > 0) {
    result = group.all.every((item) => matchesItem(item, context));
    if (!result) return false;
  }

  if (group.any && group.any.length > 0) {
    result = group.any.some((item) => matchesItem(item, context));
    if (!result) return false;
  }

  return result;
}

function matchesItem(item: RuleCondition | RuleGroup, context: Record<string, unknown>): boolean {
  if ("all" in item || "any" in item) {
    return matchesGroup(item, context);
  }
  return matchesCondition(item as RuleCondition, context);
}

function matchesCondition(condition: RuleCondition, context: Record<string, unknown>): boolean {
  const actual = resolveField(condition.field, context);

  if (condition.eq !== undefined && actual !== condition.eq) return false;
  if (condition.neq !== undefined && actual === condition.neq) return false;
  if (condition.gt !== undefined && Number(actual) <= condition.gt) return false;
  if (condition.lt !== undefined && Number(actual) >= condition.lt) return false;
  if (condition.gte !== undefined && Number(actual) < condition.gte) return false;
  if (condition.lte !== undefined && Number(actual) > condition.lte) return false;

  if (condition.in !== undefined) {
    if (!Array.isArray(condition.in) || !condition.in.some((v) => v === actual)) {
      return false;
    }
  }

  if (condition.between !== undefined) {
    const num = Number(actual);
    if (num < condition.between[0] || num > condition.between[1]) return false;
  }

  if (condition.contains !== undefined) {
    if (typeof actual !== "string" || !actual.includes(condition.contains)) {
      return false;
    }
  }

  return true;
}

function resolveField(field: string, context: Record<string, unknown>): unknown {
  return context[field];
}

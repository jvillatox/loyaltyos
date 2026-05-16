import type { Prisma } from "@prisma/client";

import type { RuleCondition, RuleGroup } from "./types.js";
import { InvalidSegmentRuleError } from "./types.js";

export function evaluateRulesInContext(
  rules: Record<string, unknown> | null | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!rules || Object.keys(rules).length === 0) {
    return true;
  }
  return matchesGroup(rules as unknown as RuleGroup, context);
}

function matchesGroup(group: RuleGroup, context: Record<string, unknown>): boolean {
  if (group.all && group.all.length > 0) {
    const allMatch = group.all.every((item) => matchesItem(item, context));
    if (!allMatch) return false;
  }

  if (group.any && group.any.length > 0) {
    const anyMatch = group.any.some((item) => matchesItem(item, context));
    if (!anyMatch) return false;
  }

  return true;
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

const COMPUTED_FIELDS = new Set(["totalSpent"]);

export function hasComputedFields(rules: Record<string, unknown> | null | undefined): boolean {
  if (!rules) return false;
  return checkForField(rules as unknown as RuleGroup, COMPUTED_FIELDS);
}

function checkForField(group: RuleGroup, fields: Set<string>): boolean {
  const items = [...(group.all ?? []), ...(group.any ?? [])];
  for (const item of items) {
    if ("all" in item || "any" in item) {
      if (checkForField(item, fields)) return true;
    } else if (fields.has((item as RuleCondition).field)) {
      return true;
    }
  }
  return false;
}

const DIRECT_FIELDS = new Set([
  "email",
  "phone",
  "firstName",
  "lastName",
  "tags",
  "joinedAt",
  "currentTier",
]);

export function ruleGroupToPrismaWhere(
  rules: Record<string, unknown> | null | undefined,
): Prisma.MemberWhereInput {
  if (!rules || Object.keys(rules).length === 0) {
    return {};
  }
  return convertGroup(rules as unknown as RuleGroup);
}

function convertGroup(group: RuleGroup): Prisma.MemberWhereInput {
  const conditions: Prisma.MemberWhereInput[] = [];

  if (group.all && group.all.length > 0) {
    conditions.push({ AND: group.all.map(convertItem) });
  }
  if (group.any && group.any.length > 0) {
    conditions.push({ OR: group.any.map(convertItem) });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1 && conditions[0]) return conditions[0];
  return { AND: conditions };
}

function convertItem(item: RuleCondition | RuleGroup): Prisma.MemberWhereInput {
  if ("all" in item || "any" in item) {
    return convertGroup(item);
  }
  return convertCondition(item as RuleCondition);
}

function convertCondition(cond: RuleCondition): Prisma.MemberWhereInput {
  const { field } = cond;

  if (!DIRECT_FIELDS.has(field)) {
    throw new InvalidSegmentRuleError(`Field "${field}" cannot be converted to a database query`);
  }

  switch (field) {
    case "currentTier":
      return convertTierCondition(cond);
    case "tags":
      return convertTagsCondition(cond);
    case "joinedAt":
      return convertDateCondition(cond, "joinedAt");
    case "email":
    case "phone":
    case "firstName":
    case "lastName":
      return convertStringCondition(cond, field);
    default:
      return {};
  }
}

function convertTierCondition(cond: RuleCondition): Prisma.MemberWhereInput {
  const tierNameFilter: Record<string, unknown> = {};

  if (cond.eq !== undefined) {
    tierNameFilter.equals = cond.eq;
  } else if (cond.neq !== undefined) {
    tierNameFilter.not = cond.neq;
  } else if (cond.in !== undefined) {
    tierNameFilter.in = cond.in;
  } else {
    return {};
  }

  return {
    memberTiers: {
      some: {
        downgradedAt: null,
        tier: { name: tierNameFilter },
      },
    },
  };
}

function convertTagsCondition(cond: RuleCondition): Prisma.MemberWhereInput {
  if (cond.contains !== undefined) {
    return { tags: { hasSome: [cond.contains] } };
  }
  return {};
}

function convertDateCondition(cond: RuleCondition, field: string): Prisma.MemberWhereInput {
  const where: Record<string, unknown> = {};

  if (cond.gt !== undefined) where.gt = new Date(cond.gt);
  if (cond.gte !== undefined) where.gte = new Date(cond.gte);
  if (cond.lt !== undefined) where.lt = new Date(cond.lt);
  if (cond.lte !== undefined) where.lte = new Date(cond.lte);
  if (cond.between !== undefined) {
    where.gte = new Date(cond.between[0]);
    where.lte = new Date(cond.between[1]);
  }
  if (cond.eq !== undefined) where.equals = new Date(cond.eq as number);

  return { [field]: where };
}

function convertStringCondition(cond: RuleCondition, field: string): Prisma.MemberWhereInput {
  const where: Record<string, unknown> = {};
  const mode = "insensitive";

  if (cond.eq !== undefined) {
    where.equals = cond.eq;
  } else if (cond.neq !== undefined) {
    where.not = cond.neq;
  } else if (cond.in !== undefined) {
    where.in = cond.in;
  } else if (cond.contains !== undefined) {
    where.contains = cond.contains;
    where.mode = mode;
  } else {
    return {};
  }

  return { [field]: where };
}

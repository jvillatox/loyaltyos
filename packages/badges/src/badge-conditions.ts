import { evaluateRulesInContext } from "@loyaltyos/segments";
import type { Badge } from "@prisma/client";

import type { MemberAggregate } from "./types.js";

interface EventRow {
  type: string;
  createdAt: Date;
  payload: unknown;
}

export interface ComputedProgress {
  progress: number; // 0-100
  currentValue: number;
  targetValue: number;
  remainingCount: number;
  met: boolean;
}

/**
 * Evaluate whether a member meets a badge's conditions.
 * Extends the segments DSL with temporal operators:
 * - `within`: check if member satisfies condition within a time window (e.g. "30 days")
 * - `since`: member must have been a member since (e.g. joined 90+ days ago)
 * - `count_in_window`: count events of a type in a rolling time window
 */
export function evaluateBadgeConditions(
  badge: Pick<Badge, "conditions" | "type">,
  aggregate: MemberAggregate,
  recentEvents: EventRow[],
): boolean {
  const conditions = badge.conditions as Record<string, unknown> | null;
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }

  // Build context for rule evaluation
  const context: Record<string, unknown> = {
    // Standard fields (segments DSL)
    totalSpent: aggregate.totalSpent,
    currentTier: aggregate.currentTier,
    tags: aggregate.tags,
    joinedAt: aggregate.joinedAt.getTime(),
    email: aggregate.email,
    phone: aggregate.phone,
    firstName: aggregate.firstName,
    lastName: aggregate.lastName,
    currentBalance: aggregate.currentBalance,
    totalEarned: aggregate.totalEarned,
    totalRedeemed: aggregate.totalRedeemed,

    // Temporal/computed fields
    daysSinceJoined: Math.floor(
      (Date.now() - aggregate.joinedAt.getTime()) / (1000 * 60 * 60 * 24),
    ),
    eventCounts: aggregate.eventCounts,
    daysSinceLastEvent: aggregate.lastEventAt
      ? Math.floor((Date.now() - aggregate.lastEventAt.getTime()) / (1000 * 60 * 60 * 24))
      : 999,
  };

  // Handle temporal operators before delegating to standard evaluator
  if (conditions.count_in_window) {
    const ciw = conditions.count_in_window as {
      eventType: string;
      days: number;
      min?: number;
      gte?: number;
    };
    if (ciw.eventType && ciw.days) {
      const since = new Date(Date.now() - ciw.days * 24 * 60 * 60 * 1000);
      const count = recentEvents.filter(
        (e) => e.type === ciw.eventType && e.createdAt >= since,
      ).length;
      const threshold = ciw.gte ?? ciw.min ?? 1;
      if (count < threshold) return false;
    }
  }

  if (conditions.within) {
    const w = conditions.within as {
      field?: string;
      days: number;
      condition?: Record<string, unknown>;
    };
    if (w.days) {
      const since = new Date(Date.now() - w.days * 24 * 60 * 60 * 1000);
      const relevantCount = recentEvents.filter((e) => e.createdAt >= since).length;
      if (relevantCount === 0) return false;
    }
  }

  // Delegate standard operator evaluation to segments rule evaluator
  // Strip temporal operators before passing
  const standardConditions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(conditions)) {
    if (!["count_in_window", "within", "since"].includes(key)) {
      standardConditions[key] = value;
    }
  }

  if (Object.keys(standardConditions).length > 0) {
    return evaluateRulesInContext(standardConditions, context);
  }

  return true;
}

/**
 * Compute progress (0-100) toward unlocking a badge.
 * Progress is derived from the badge conditions:
 * - If conditions have a numeric threshold (gte, eq), compute progress as current/target * 100
 * - For count_in_window: current count / required count
 * - Default: 0 or 100 based on met/unmet
 */
export function computeProgress(
  badge: Pick<Badge, "conditions" | "type">,
  aggregate: MemberAggregate,
  recentEvents: EventRow[],
  alreadyUnlocked: boolean,
): ComputedProgress {
  if (alreadyUnlocked) {
    return { progress: 100, currentValue: 1, targetValue: 1, remainingCount: 0, met: true };
  }

  const conditions = badge.conditions as Record<string, unknown> | null;
  if (!conditions || Object.keys(conditions).length === 0) {
    // No conditions — badge is awarded manually
    return { progress: 0, currentValue: 0, targetValue: 0, remainingCount: 0, met: false };
  }

  // Try count_in_window
  if (conditions.count_in_window) {
    const ciw = conditions.count_in_window as {
      eventType: string;
      days: number;
      min?: number;
      gte?: number;
    };
    const threshold = ciw.gte ?? ciw.min ?? 1;
    const since = new Date(Date.now() - ciw.days * 24 * 60 * 60 * 1000);
    const count = recentEvents.filter(
      (e) => e.type === ciw.eventType && e.createdAt >= since,
    ).length;
    const pct = Math.min(100, Math.round((count / threshold) * 100));
    return {
      progress: pct,
      currentValue: count,
      targetValue: threshold,
      remainingCount: Math.max(0, threshold - count),
      met: count >= threshold,
    };
  }

  // Try numeric field threshold
  if (conditions.all && Array.isArray(conditions.all)) {
    for (const item of conditions.all) {
      const rule = item as Record<string, unknown>;
      if (rule.field === "totalSpent" && rule.gte !== undefined) {
        const target = Number(rule.gte);
        const pct = Math.min(100, Math.round((aggregate.totalSpent / target) * 100));
        return {
          progress: pct,
          currentValue: aggregate.totalSpent,
          targetValue: target,
          remainingCount: Math.max(0, target - aggregate.totalSpent),
          met: aggregate.totalSpent >= target,
        };
      }
      if (rule.field === "totalEarned" && rule.gte !== undefined) {
        const target = Number(rule.gte);
        const pct = Math.min(100, Math.round((aggregate.totalEarned / target) * 100));
        return {
          progress: pct,
          currentValue: aggregate.totalEarned,
          targetValue: target,
          remainingCount: Math.max(0, target - aggregate.totalEarned),
          met: aggregate.totalEarned >= target,
        };
      }
    }
  }

  // Fallback: evaluate met/unmet → 100 or 0
  const met = evaluateBadgeConditions(badge, aggregate, recentEvents);
  return {
    progress: met ? 100 : 0,
    currentValue: met ? 1 : 0,
    targetValue: 1,
    remainingCount: met ? 0 : 1,
    met,
  };
}

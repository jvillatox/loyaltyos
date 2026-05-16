import type { Segment } from "@prisma/client";

export type SegmentRow = Segment;

export interface SegmentCreateInput {
  programId: string;
  name: string;
  description?: string;
  type: "STATIC" | "DYNAMIC";
  rules?: Record<string, unknown>;
  memberIds?: string[];
}

export interface SegmentUpdateInput {
  name?: string;
  description?: string;
  rules?: Record<string, unknown>;
  memberIds?: string[];
}

export interface SegmentListFilters {
  type?: "STATIC" | "DYNAMIC";
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface SegmentEvaluationResult {
  belongsTo: boolean;
}

export interface MemberWithComputedFields {
  id: string;
  programId: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  joinedAt: Date;
  deletedAt: Date | null;
  totalSpent: number;
  currentTier: string | null;
}

export interface RuleCondition {
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

export interface RuleGroup {
  all?: (RuleCondition | RuleGroup)[];
  any?: (RuleCondition | RuleGroup)[];
}

export class SegmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Segment not found: ${id}`);
    this.name = "SegmentNotFoundError";
  }
}

export class SegmentNotActiveError extends Error {
  constructor(id: string) {
    super(`Segment is not active: ${id}`);
    this.name = "SegmentNotActiveError";
  }
}

export class SegmentNotStaticError extends Error {
  constructor(id: string) {
    super(`Segment ${id} is not STATIC — cannot modify memberIds directly`);
    this.name = "SegmentNotStaticError";
  }
}

export class InvalidSegmentRuleError extends Error {
  constructor(message: string) {
    super(`Invalid segment rule: ${message}`);
    this.name = "InvalidSegmentRuleError";
  }
}

export { hashPassword, verifyPassword } from "./auth/password.js";
export { addMonths, lotExpiresAt } from "./expiry.js";
export { applyTxToBalance, verifyConsistency } from "./ledger.js";
export type { Repository } from "./repository.js";
export { createRepository } from "./repository.js";
export { calculateEffectiveAmount, evaluateRules } from "./rules.js";
export type { PointsServiceMetrics, PointsServiceOptions } from "./service.js";
export { PointsService } from "./service.js";
export type {
  AdjustInput,
  AdjustResult,
  Balance,
  EarnInput,
  EarnResult,
  NextExpiry,
  PaginatedResult,
  PaginationParams,
  RedeemInput,
  RedeemResult,
  ReverseResult,
  UpcomingExpiry,
} from "./types.js";
export {
  AlreadyReversedError,
  CannotReverseError,
  DuplicateIdempotencyKeyError,
  InsufficientBalanceError,
  InvalidRuleError,
  TransactionNotFoundError,
} from "./types.js";

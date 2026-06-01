import {
  CampaignBudgetExhaustedError,
  CampaignNotActiveError,
  CampaignNotFoundError,
  CampaignOutOfValidityError,
  CampaignUserLimitReachedError,
} from "@loyaltyos/campaigns";
import {
  CoalitionAccountNotLinkedError,
  CoalitionBusinessError,
  CoalitionCircuitOpenError,
  CoalitionConfigNotFoundError,
  CoalitionTransientError,
  CoalitionUnsupportedError,
} from "@loyaltyos/coalition";
import {
  AlreadyReversedError,
  InsufficientBalanceError,
  TransactionNotFoundError,
} from "@loyaltyos/core";
import {
  CouponChannelError,
  CouponCodeDuplicateError,
  CouponExhaustedError,
  CouponExpiredError,
  CouponMemberLimitError,
  CouponMinPurchaseError,
  CouponNotFoundError,
  CouponNotStartedError,
} from "@loyaltyos/coupons";
import {
  BatchNotCancellableError,
  GiftCardBatchNotFoundError,
  GiftCardCancelledError,
  GiftCardCodeCollisionError,
  GiftCardConcurrentUpdateError,
  GiftCardExpiredError,
  GiftCardIdempotencyConflictError,
  GiftCardInsufficientBalanceError,
  GiftCardInvalidCodeError,
  GiftCardLockError,
  GiftCardNotActiveError,
  GiftCardNotFoundError,
  GiftCardRedeemedError,
  RefundExceedsInitialError,
  TermsTemplateNotFoundError,
} from "@loyaltyos/giftcards";
import type { SupportedLocale } from "@loyaltyos/i18n";
import { resolveLocale } from "@loyaltyos/i18n";
import enUS from "@loyaltyos/i18n/src/locales/en-US.json" with { type: "json" };
import esMX from "@loyaltyos/i18n/src/locales/es-MX.json" with { type: "json" };
import {
  RewardInsufficientPointsError,
  RewardNotActiveError,
  RewardNotFoundError,
  RewardOutOfStockError,
  RewardTierInsufficientError,
} from "@loyaltyos/rewards";
import {
  InvalidSegmentRuleError,
  SegmentNotActiveError,
  SegmentNotFoundError,
  SegmentNotStaticError,
} from "@loyaltyos/segments";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { LoyaltyError } from "./errors.js";

const CATALOGS: Record<SupportedLocale, Record<string, unknown>> = {
  "es-MX": esMX,
  "en-US": enUS,
};

interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function localizeMessage(code: string, locale: SupportedLocale): string {
  const catalog = CATALOGS[locale];
  const parts = ["errors", ...code.split(".")];
  let current: unknown = catalog;
  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return code;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : code;
}

function getLocale(req: FastifyRequest): SupportedLocale {
  const acceptLanguage = req.headers["accept-language"];
  return resolveLocale({ acceptLanguage });
}

function mapError(
  err: FastifyError | Error | LoyaltyError,
  locale: SupportedLocale,
): { status: number; body: { error: ApiError } } {
  // LoyaltyError — user-thrown with explicit code
  if (err instanceof LoyaltyError) {
    return {
      status: err.httpStatus,
      body: {
        error: {
          code: err.code,
          message: localizeMessage(err.code, locale),
          // NOTE: err.params is intentionally NOT forwarded to the client.
          // If a future endpoint needs structured failure details (e.g., gift
          // card validation), add an explicit `clientDetails` field to
          // LoyaltyError that requires conscious opt-in per call site.
        },
      },
    };
  }

  // Validation
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: localizeMessage("VALIDATION_ERROR", locale),
          details: err.errors,
        },
      },
    };
  }

  // Core domain errors
  if (err instanceof InsufficientBalanceError) {
    return {
      status: 422,
      body: {
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: localizeMessage("INSUFFICIENT_BALANCE", locale),
          details: { available: (err as unknown as { available?: number }).available },
        },
      },
    };
  }

  if (err instanceof TransactionNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "TRANSACTION_NOT_FOUND",
          message: localizeMessage("TRANSACTION_NOT_FOUND", locale),
        },
      },
    };
  }

  if (err instanceof AlreadyReversedError) {
    return {
      status: 409,
      body: {
        error: {
          code: "ALREADY_REVERSED",
          message: localizeMessage("ALREADY_REVERSED", locale),
        },
      },
    };
  }

  // Campaign domain errors
  if (err instanceof CampaignNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "CAMPAIGN_NOT_FOUND",
          message: localizeMessage("CAMPAIGN_NOT_FOUND", locale),
        },
      },
    };
  }

  if (err instanceof CampaignNotActiveError) {
    return {
      status: 409,
      body: {
        error: {
          code: "CAMPAIGN_NOT_ACTIVE",
          message: localizeMessage("CAMPAIGN_NOT_ACTIVE", locale),
        },
      },
    };
  }

  if (err instanceof CampaignBudgetExhaustedError) {
    return {
      status: 422,
      body: {
        error: {
          code: "CAMPAIGN_BUDGET_EXHAUSTED",
          message: localizeMessage("CAMPAIGN_BUDGET_EXHAUSTED", locale),
        },
      },
    };
  }

  if (err instanceof CampaignUserLimitReachedError) {
    return {
      status: 422,
      body: {
        error: {
          code: "CAMPAIGN_USER_LIMIT_REACHED",
          message: localizeMessage("CAMPAIGN_USER_LIMIT_REACHED", locale),
        },
      },
    };
  }

  if (err instanceof CampaignOutOfValidityError) {
    return {
      status: 422,
      body: {
        error: {
          code: "CAMPAIGN_OUT_OF_VALIDITY",
          message: localizeMessage("CAMPAIGN_OUT_OF_VALIDITY", locale),
        },
      },
    };
  }

  // Coupon domain errors
  if (err instanceof CouponNotFoundError) {
    return {
      status: 404,
      body: {
        error: { code: "COUPON_NOT_FOUND", message: localizeMessage("COUPON_NOT_FOUND", locale) },
      },
    };
  }

  if (err instanceof CouponCodeDuplicateError) {
    return {
      status: 409,
      body: {
        error: {
          code: "COUPON_CODE_DUPLICATE",
          message: localizeMessage("COUPON_CODE_DUPLICATE", locale),
        },
      },
    };
  }

  if (err instanceof CouponExpiredError) {
    return {
      status: 422,
      body: {
        error: { code: "COUPON_EXPIRED", message: localizeMessage("COUPON_EXPIRED", locale) },
      },
    };
  }

  if (err instanceof CouponNotStartedError) {
    return {
      status: 422,
      body: {
        error: {
          code: "COUPON_NOT_STARTED",
          message: localizeMessage("COUPON_NOT_STARTED", locale),
        },
      },
    };
  }

  if (err instanceof CouponExhaustedError) {
    return {
      status: 422,
      body: {
        error: { code: "COUPON_EXHAUSTED", message: localizeMessage("COUPON_EXHAUSTED", locale) },
      },
    };
  }

  if (err instanceof CouponMemberLimitError) {
    return {
      status: 422,
      body: {
        error: {
          code: "COUPON_MEMBER_LIMIT",
          message: localizeMessage("COUPON_MEMBER_LIMIT", locale),
        },
      },
    };
  }

  if (err instanceof CouponMinPurchaseError) {
    return {
      status: 422,
      body: {
        error: {
          code: "COUPON_MIN_PURCHASE",
          message: localizeMessage("COUPON_MIN_PURCHASE", locale),
        },
      },
    };
  }

  if (err instanceof CouponChannelError) {
    return {
      status: 422,
      body: {
        error: {
          code: "COUPON_CHANNEL_ERROR",
          message: localizeMessage("COUPON_CHANNEL_ERROR", locale),
        },
      },
    };
  }

  // Gift card domain errors
  if (err instanceof GiftCardNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "GIFT_CARD_NOT_FOUND",
          message: localizeMessage("GIFT_CARD_NOT_FOUND", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardExpiredError) {
    return {
      status: 422,
      body: {
        error: {
          code: "GIFT_CARD_EXPIRED",
          message: localizeMessage("GIFT_CARD_EXPIRED", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardRedeemedError) {
    return {
      status: 422,
      body: {
        error: {
          code: "GIFT_CARD_DEPLETED",
          message: localizeMessage("GIFT_CARD_DEPLETED", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardCancelledError) {
    return {
      status: 422,
      body: {
        error: {
          code: "GIFT_CARD_CANCELLED",
          message: localizeMessage("GIFT_CARD_CANCELLED", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardInsufficientBalanceError) {
    const gcErr = err;
    return {
      status: 422,
      body: {
        error: {
          code: "GIFT_CARD_INSUFFICIENT_BALANCE",
          message: localizeMessage("GIFT_CARD_INSUFFICIENT_BALANCE", locale),
          details: {
            requested: gcErr.requested,
            available: gcErr.available,
          },
        },
      },
    };
  }

  if (err instanceof GiftCardBatchNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "GIFT_CARD_BATCH_NOT_FOUND",
          message: localizeMessage("GIFT_CARD_BATCH_NOT_FOUND", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardInvalidCodeError) {
    return {
      status: 422,
      body: {
        error: {
          code: "GIFT_CARD_INVALID_CODE",
          message: localizeMessage("GIFT_CARD_INVALID_CODE", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardIdempotencyConflictError) {
    return {
      status: 409,
      body: {
        error: {
          code: "GIFT_CARD_IDEMPOTENCY_CONFLICT",
          message: localizeMessage("GIFT_CARD_IDEMPOTENCY_CONFLICT", locale),
        },
      },
    };
  }

  if (err instanceof TermsTemplateNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "GIFT_CARD_TERMS_TEMPLATE_NOT_FOUND",
          message: localizeMessage("GIFT_CARD_TERMS_TEMPLATE_NOT_FOUND", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardLockError) {
    return {
      status: 409,
      body: {
        error: {
          code: "GIFT_CARD_LOCK",
          message: localizeMessage("GIFT_CARD_LOCK", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardNotActiveError) {
    return {
      status: 422,
      body: {
        error: {
          code: "GIFT_CARD_NOT_ACTIVE",
          message: localizeMessage("GIFT_CARD_NOT_ACTIVE", locale),
        },
      },
    };
  }

  if (err instanceof BatchNotCancellableError) {
    return {
      status: 409,
      body: {
        error: {
          code: "BATCH_NOT_CANCELLABLE",
          message: localizeMessage("BATCH_NOT_CANCELLABLE", locale),
          details: { redeemedCount: err.redeemedCount },
        },
      },
    };
  }

  if (err instanceof RefundExceedsInitialError) {
    return {
      status: 422,
      body: {
        error: {
          code: "REFUND_EXCEEDS_INITIAL",
          message: localizeMessage("REFUND_EXCEEDS_INITIAL", locale),
          details: {
            initialAmount: err.initialAmount,
            currentBalance: err.currentBalance,
            refundAmount: err.refundAmount,
          },
        },
      },
    };
  }

  if (err instanceof GiftCardCodeCollisionError) {
    return {
      status: 500,
      body: {
        error: {
          code: "GIFT_CARD_CODE_COLLISION",
          message: localizeMessage("GIFT_CARD_CODE_COLLISION", locale),
        },
      },
    };
  }

  if (err instanceof GiftCardConcurrentUpdateError) {
    return {
      status: 409,
      body: {
        error: {
          code: "GIFT_CARD_CONCURRENT_UPDATE",
          message: localizeMessage("GIFT_CARD_CONCURRENT_UPDATE", locale),
        },
      },
    };
  }

  // Reward domain errors
  if (err instanceof RewardNotFoundError) {
    return {
      status: 404,
      body: {
        error: { code: "REWARD_NOT_FOUND", message: localizeMessage("REWARD_NOT_FOUND", locale) },
      },
    };
  }

  if (err instanceof RewardNotActiveError) {
    return {
      status: 422,
      body: {
        error: { code: "REWARD_NOT_ACTIVE", message: localizeMessage("REWARD_NOT_ACTIVE", locale) },
      },
    };
  }

  if (err instanceof RewardOutOfStockError) {
    return {
      status: 422,
      body: {
        error: {
          code: "REWARD_OUT_OF_STOCK",
          message: localizeMessage("REWARD_OUT_OF_STOCK", locale),
        },
      },
    };
  }

  if (err instanceof RewardTierInsufficientError) {
    return {
      status: 422,
      body: {
        error: {
          code: "REWARD_TIER_INSUFFICIENT",
          message: localizeMessage("REWARD_TIER_INSUFFICIENT", locale),
        },
      },
    };
  }

  if (err instanceof RewardInsufficientPointsError) {
    return {
      status: 422,
      body: {
        error: {
          code: "REWARD_INSUFFICIENT_POINTS",
          message: localizeMessage("REWARD_INSUFFICIENT_POINTS", locale),
        },
      },
    };
  }

  // Coalition domain errors
  if (err instanceof CoalitionConfigNotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: "COALITION_CONFIG_NOT_FOUND",
          message: localizeMessage("COALITION_CONFIG_NOT_FOUND", locale),
        },
      },
    };
  }

  if (err instanceof CoalitionAccountNotLinkedError) {
    return {
      status: 404,
      body: {
        error: {
          code: "COALITION_ACCOUNT_NOT_LINKED",
          message: localizeMessage("COALITION_ACCOUNT_NOT_LINKED", locale),
        },
      },
    };
  }

  if (err instanceof CoalitionBusinessError) {
    return {
      status: 422,
      body: {
        error: {
          code: "COALITION_BUSINESS_ERROR",
          message: localizeMessage("COALITION_BUSINESS_ERROR", locale),
        },
      },
    };
  }

  if (err instanceof CoalitionTransientError) {
    return {
      status: 502,
      body: {
        error: {
          code: "EXTERNAL_SERVICE_ERROR",
          message: localizeMessage("EXTERNAL_SERVICE_ERROR", locale),
        },
      },
    };
  }

  if (err instanceof CoalitionCircuitOpenError) {
    return {
      status: 503,
      body: {
        error: { code: "CIRCUIT_OPEN", message: localizeMessage("CIRCUIT_OPEN", locale) },
      },
    };
  }

  if (err instanceof CoalitionUnsupportedError) {
    return {
      status: 501,
      body: {
        error: {
          code: "UNSUPPORTED_OPERATION",
          message: localizeMessage("UNSUPPORTED_OPERATION", locale),
        },
      },
    };
  }

  // Segment domain errors
  if (err instanceof SegmentNotFoundError) {
    return {
      status: 404,
      body: {
        error: { code: "SEGMENT_NOT_FOUND", message: localizeMessage("SEGMENT_NOT_FOUND", locale) },
      },
    };
  }

  if (err instanceof SegmentNotActiveError) {
    return {
      status: 422,
      body: {
        error: {
          code: "SEGMENT_NOT_ACTIVE",
          message: localizeMessage("SEGMENT_NOT_ACTIVE", locale),
        },
      },
    };
  }

  if (err instanceof SegmentNotStaticError) {
    return {
      status: 422,
      body: {
        error: {
          code: "SEGMENT_NOT_STATIC",
          message: localizeMessage("SEGMENT_NOT_STATIC", locale),
        },
      },
    };
  }

  if (err instanceof InvalidSegmentRuleError) {
    return {
      status: 400,
      body: {
        error: {
          code: "INVALID_SEGMENT_RULE",
          message: localizeMessage("INVALID_SEGMENT_RULE", locale),
        },
      },
    };
  }

  // Fastify validation
  const fastifyErr = err as FastifyError;
  if (fastifyErr.statusCode) {
    return {
      status: fastifyErr.statusCode,
      body: {
        error: {
          code: fastifyErr.code || "REQUEST_ERROR",
          message: localizeMessage(fastifyErr.code || "REQUEST_ERROR", locale),
        },
      },
    };
  }

  // Unknown
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: localizeMessage("INTERNAL_ERROR", locale),
      },
    },
  };
}

export { LoyaltyError };

export async function errorHandler(
  err: FastifyError | Error | LoyaltyError,
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const locale = getLocale(_req);
  const { status, body } = mapError(err, locale);
  if (status === 500) {
    _req.log.error(err);
  }
  await reply.status(status).send(body);
}

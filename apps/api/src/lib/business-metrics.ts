import type { CoalitionServiceMetrics } from "@loyaltyos/coalition";
import type { PointsServiceMetrics } from "@loyaltyos/core";
import type { CouponsServiceMetrics } from "@loyaltyos/coupons";
import type { GiftCardsServiceMetrics } from "@loyaltyos/giftcards";
import type { BusinessMetrics, Registry } from "@loyaltyos/telemetry";
import { createBusinessMetrics, createMetricsRegistry } from "@loyaltyos/telemetry";

const registry = createMetricsRegistry();
const metrics = createBusinessMetrics(registry);

export function getBusinessMetricsRegistry(): Registry {
  return registry;
}

export function getBusinessMetrics(): BusinessMetrics {
  return metrics;
}

export function adaptPointsMetrics(bm: BusinessMetrics): PointsServiceMetrics {
  return {
    recordEarn(programId, _amount, idempotent) {
      bm.pointsEarnedTotal.inc({ program_id: programId, idempotent: String(idempotent) });
    },
    recordRedeem(programId, _amount) {
      bm.pointsRedeemedTotal.inc({ program_id: programId });
    },
    recordAdjust(programId, _amount) {
      bm.pointsAdjustedTotal.inc({ program_id: programId });
    },
    recordReverse(programId, originalType) {
      bm.pointsReversedTotal.inc({ program_id: programId, original_type: originalType });
    },
    recordExpire(programId) {
      bm.pointsExpiredTotal.inc({ program_id: programId });
    },
    recordInsufficientBalance(programId) {
      bm.insufficientBalanceTotal.inc({ program_id: programId });
    },
    setProgramBalance(programId, balance) {
      bm.pointsBalance.set({ program_id: programId }, balance);
    },
    setActiveMembers(programId, count) {
      bm.activeMembersTotal.set({ program_id: programId }, count);
    },
  };
}

export function adaptCouponsMetrics(bm: BusinessMetrics): CouponsServiceMetrics {
  return {
    recordRedeem(programId, discountAmount) {
      bm.couponsRedeemedTotal.inc({ program_id: programId });
      bm.couponsDiscountAmount.observe({ program_id: programId }, discountAmount);
    },
    recordCreate(programId) {
      bm.couponsCreatedTotal.inc({ program_id: programId });
    },
  };
}

export function adaptCoalitionMetrics(bm: BusinessMetrics): CoalitionServiceMetrics {
  return {
    recordOperation(provider, operation, status, _idempotent) {
      bm.coalitionOperationsTotal.inc({ provider, operation, status });
    },
    setCircuitBreakerState(adapter, state) {
      bm.coalitionCircuitBreakerState.set({ adapter }, state);
    },
  };
}

export function adaptGiftCardMetrics(bm: BusinessMetrics): GiftCardsServiceMetrics {
  return {
    recordGenerate(programId, currency, count) {
      bm.giftCardsGeneratedTotal.inc({ program_id: programId, currency }, count);
    },
    recordRedeem(programId, currency) {
      bm.giftCardsRedeemedTotal.inc({ program_id: programId, currency });
    },
    recordRedeemedAmount(programId, currency, amount) {
      bm.giftCardsRedeemedAmount.inc({ program_id: programId, currency }, amount);
    },
    setOutstandingBalance(programId, currency, balance) {
      bm.giftCardsOutstandingBalance.set({ program_id: programId, currency }, balance);
    },
  };
}

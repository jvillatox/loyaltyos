import { describe, expect, it } from "vitest";

import { createBusinessMetrics, createMetricsRegistry, getMetricsPayload } from "../metrics.js";

describe("business metrics", () => {
  describe("createBusinessMetrics", () => {
    it("registers all 13 business metrics in the registry", () => {
      const registry = createMetricsRegistry();
      const metrics = createBusinessMetrics(registry);

      expect(metrics.pointsEarnedTotal).toBeDefined();
      expect(metrics.pointsRedeemedTotal).toBeDefined();
      expect(metrics.pointsReversedTotal).toBeDefined();
      expect(metrics.pointsAdjustedTotal).toBeDefined();
      expect(metrics.pointsExpiredTotal).toBeDefined();
      expect(metrics.pointsBalance).toBeDefined();
      expect(metrics.insufficientBalanceTotal).toBeDefined();
      expect(metrics.couponsRedeemedTotal).toBeDefined();
      expect(metrics.couponsCreatedTotal).toBeDefined();
      expect(metrics.couponsDiscountAmount).toBeDefined();
      expect(metrics.coalitionOperationsTotal).toBeDefined();
      expect(metrics.coalitionCircuitBreakerState).toBeDefined();
      expect(metrics.activeMembersTotal).toBeDefined();
    });

    it("increments pointsEarnedTotal with program_id and idempotent labels", async () => {
      const registry = createMetricsRegistry();
      const metrics = createBusinessMetrics(registry);

      metrics.pointsEarnedTotal.inc({ program_id: "prog-1", idempotent: "false" });
      metrics.pointsEarnedTotal.inc({ program_id: "prog-1", idempotent: "true" });
      metrics.pointsEarnedTotal.inc({ program_id: "prog-2", idempotent: "false" });

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain(
        'loyaltyos_points_earned_total{program_id="prog-1",idempotent="false"} 1',
      );
      expect(payload).toContain(
        'loyaltyos_points_earned_total{program_id="prog-1",idempotent="true"} 1',
      );
      expect(payload).toContain(
        'loyaltyos_points_earned_total{program_id="prog-2",idempotent="false"} 1',
      );
    });

    it("increments couponsRedeemedTotal and observes discount amount", async () => {
      const registry = createMetricsRegistry();
      const metrics = createBusinessMetrics(registry);

      metrics.couponsRedeemedTotal.inc({ program_id: "prog-1" });
      metrics.couponsRedeemedTotal.inc({ program_id: "prog-1" });
      metrics.couponsDiscountAmount.observe({ program_id: "prog-1" }, 25);
      metrics.couponsDiscountAmount.observe({ program_id: "prog-1" }, 100);

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain('loyaltyos_coupons_redeemed_total{program_id="prog-1"} 2');
      // Histogram observations should produce sum and count
      expect(payload).toContain("loyaltyos_coupons_discount_amount_sum");
      expect(payload).toContain("loyaltyos_coupons_discount_amount_count");
    });

    it("increments coalitionOperationsTotal with provider label", async () => {
      const registry = createMetricsRegistry();
      const metrics = createBusinessMetrics(registry);

      metrics.coalitionOperationsTotal.inc({
        provider: "APPRECIO",
        operation: "EARN",
        status: "CONFIRMED",
      });
      metrics.coalitionOperationsTotal.inc({
        provider: "APPRECIO",
        operation: "REDEEM",
        status: "CONFIRMED",
      });
      metrics.coalitionOperationsTotal.inc({
        provider: "APPRECIO",
        operation: "CONVERT",
        status: "FAILED",
      });

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain(
        'loyaltyos_coalition_operations_total{provider="APPRECIO",operation="EARN",status="CONFIRMED"} 1',
      );
      expect(payload).toContain(
        'loyaltyos_coalition_operations_total{provider="APPRECIO",operation="REDEEM",status="CONFIRMED"} 1',
      );
      expect(payload).toContain(
        'loyaltyos_coalition_operations_total{provider="APPRECIO",operation="CONVERT",status="FAILED"} 1',
      );
    });

    it("sets activeMembersTotal gauge per program", async () => {
      const registry = createMetricsRegistry();
      const metrics = createBusinessMetrics(registry);

      metrics.activeMembersTotal.set({ program_id: "prog-1" }, 150);
      metrics.activeMembersTotal.set({ program_id: "prog-2" }, 42);

      const payload = await getMetricsPayload(registry);
      expect(payload).toContain('loyaltyos_active_members_total{program_id="prog-1"} 150');
      expect(payload).toContain('loyaltyos_active_members_total{program_id="prog-2"} 42');
    });
  });
});

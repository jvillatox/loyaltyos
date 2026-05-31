import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

export interface MetricsRegistry {
  registry: Registry;
  httpRequestCounter: Counter;
  httpRequestDuration: Histogram;
  httpErrorCounter: Counter;
  bullmqQueueDepth: Gauge;
  bullmqJobDuration: Histogram;
  bullmqJobCounter: Counter;
}

export function createMetricsRegistry(): Registry {
  return new Registry();
}

export function createHttpMetrics(registry: Registry) {
  const labels = ["method", "route", "status_code"] as const;

  const httpRequestCounter = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: labels as unknown as string[],
    registers: [registry],
  });

  const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: labels as unknown as string[],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpErrorCounter = new Counter({
    name: "http_errors_total",
    help: "Total number of HTTP errors (5xx responses)",
    labelNames: ["method", "route"] as unknown as string[],
    registers: [registry],
  });

  return { httpRequestCounter, httpRequestDuration, httpErrorCounter };
}

export function createBullMQMetrics(registry: Registry) {
  const labels = ["queue"] as const;

  const bullmqQueueDepth = new Gauge({
    name: "bullmq_queue_depth",
    help: "Number of jobs waiting in the queue",
    labelNames: labels as unknown as string[],
    registers: [registry],
  });

  const bullmqJobDuration = new Histogram({
    name: "bullmq_job_duration_seconds",
    help: "Job processing duration in seconds",
    labelNames: labels as unknown as string[],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
    registers: [registry],
  });

  const bullmqJobCounter = new Counter({
    name: "bullmq_jobs_total",
    help: "Total number of jobs processed",
    labelNames: ["queue", "status"] as unknown as string[],
    registers: [registry],
  });

  return { bullmqQueueDepth, bullmqJobDuration, bullmqJobCounter };
}

export interface BusinessMetrics {
  // Points
  pointsEarnedTotal: Counter;
  pointsRedeemedTotal: Counter;
  pointsReversedTotal: Counter;
  pointsAdjustedTotal: Counter;
  pointsExpiredTotal: Counter;
  pointsBalance: Gauge;
  insufficientBalanceTotal: Counter;
  // Coupons
  couponsRedeemedTotal: Counter;
  couponsCreatedTotal: Counter;
  couponsDiscountAmount: Histogram;
  // Coalition
  coalitionOperationsTotal: Counter;
  coalitionCircuitBreakerState: Gauge;
  // Members
  activeMembersTotal: Gauge;
  // Gift Cards
  giftCardsGeneratedTotal: Counter;
  giftCardsRedeemedTotal: Counter;
  giftCardsRedeemedAmount: Counter;
  giftCardsOutstandingBalance: Gauge;
}

export function createBusinessMetrics(registry: Registry): BusinessMetrics {
  const pointsEarnedTotal = new Counter({
    name: "loyaltyos_points_earned_total",
    help: "Total number of points earned",
    labelNames: ["program_id", "idempotent"] as unknown as string[],
    registers: [registry],
  });

  const pointsRedeemedTotal = new Counter({
    name: "loyaltyos_points_redeemed_total",
    help: "Total number of points redeemed",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const pointsReversedTotal = new Counter({
    name: "loyaltyos_points_reversed_total",
    help: "Total number of point reversals",
    labelNames: ["program_id", "original_type"] as unknown as string[],
    registers: [registry],
  });

  const pointsAdjustedTotal = new Counter({
    name: "loyaltyos_points_adjusted_total",
    help: "Total number of admin point adjustments",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const pointsExpiredTotal = new Counter({
    name: "loyaltyos_points_expired_total",
    help: "Total number of expired point transactions",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const pointsBalance = new Gauge({
    name: "loyaltyos_points_balance",
    help: "Current points balance per program",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const insufficientBalanceTotal = new Counter({
    name: "loyaltyos_insufficient_balance_total",
    help: "Number of failed redeem attempts due to insufficient balance",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const couponsRedeemedTotal = new Counter({
    name: "loyaltyos_coupons_redeemed_total",
    help: "Total number of coupon redemptions",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const couponsCreatedTotal = new Counter({
    name: "loyaltyos_coupons_created_total",
    help: "Total number of coupons created",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const couponsDiscountAmount = new Histogram({
    name: "loyaltyos_coupons_discount_amount",
    help: "Distribution of coupon discount amounts",
    labelNames: ["program_id"] as unknown as string[],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500],
    registers: [registry],
  });

  const coalitionOperationsTotal = new Counter({
    name: "loyaltyos_coalition_operations_total",
    help: "Total number of coalition operations",
    labelNames: ["provider", "operation", "status"] as unknown as string[],
    registers: [registry],
  });

  const coalitionCircuitBreakerState = new Gauge({
    name: "loyaltyos_coalition_circuit_breaker_state",
    help: "Circuit breaker state per coalition adapter (0=closed, 1=half-open, 2=open)",
    labelNames: ["adapter"] as unknown as string[],
    registers: [registry],
  });

  const activeMembersTotal = new Gauge({
    name: "loyaltyos_active_members_total",
    help: "Number of active members per program",
    labelNames: ["program_id"] as unknown as string[],
    registers: [registry],
  });

  const giftCardsGeneratedTotal = new Counter({
    name: "loyaltyos_giftcards_generated_total",
    help: "Total number of gift cards generated",
    labelNames: ["program_id", "currency"] as unknown as string[],
    registers: [registry],
  });

  const giftCardsRedeemedTotal = new Counter({
    name: "loyaltyos_giftcards_redeemed_total",
    help: "Total number of gift card redemption transactions",
    labelNames: ["program_id", "currency"] as unknown as string[],
    registers: [registry],
  });

  const giftCardsRedeemedAmount = new Counter({
    name: "loyaltyos_giftcards_redeemed_amount",
    help: "Total amount redeemed from gift cards",
    labelNames: ["program_id", "currency"] as unknown as string[],
    registers: [registry],
  });

  const giftCardsOutstandingBalance = new Gauge({
    name: "loyaltyos_giftcards_outstanding_balance",
    help: "Total outstanding gift card balance (liability)",
    labelNames: ["program_id", "currency"] as unknown as string[],
    registers: [registry],
  });

  return {
    pointsEarnedTotal,
    pointsRedeemedTotal,
    pointsReversedTotal,
    pointsAdjustedTotal,
    pointsExpiredTotal,
    pointsBalance,
    insufficientBalanceTotal,
    couponsRedeemedTotal,
    couponsCreatedTotal,
    couponsDiscountAmount,
    coalitionOperationsTotal,
    coalitionCircuitBreakerState,
    activeMembersTotal,
    giftCardsGeneratedTotal,
    giftCardsRedeemedTotal,
    giftCardsRedeemedAmount,
    giftCardsOutstandingBalance,
  };
}

export function setupDefaultMetrics(registry: Registry, serviceName: string): Registry {
  registry.setDefaultLabels({ service_name: serviceName });
  collectDefaultMetrics({ register: registry, prefix: "nodejs_" });
  return registry;
}

export function getMetricsContentType(): string {
  return Registry.PROMETHEUS_CONTENT_TYPE;
}

export async function getMetricsPayload(registry: Registry): Promise<string> {
  return registry.metrics();
}

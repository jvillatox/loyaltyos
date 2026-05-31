import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

import type {
  AnalyticsDashboard,
  Badge,
  BadgeProgress,
  Campaign,
  CampaignAnalytics,
  CoalitionBalance,
  CoalitionConvertResult,
  CoalitionTxResult,
  Coupon,
  Member,
  PointTransaction,
  ProgramConfig,
  RedemptionStats,
  Reward,
  Segment,
  Webhook,
} from "./types.js";

export class LoyaltyOSClient {
  private readonly http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15_000,
    });
  }

  // ── Members ──

  async getMember(id: string): Promise<Member> {
    const { data } = await this.http.get<Member>(`/api/members/${id}`);
    return data;
  }

  async listMembers(filters: {
    limit?: number;
    offset?: number;
    tier?: string;
    inactiveDays?: number;
    minBalance?: number;
    maxBalance?: number;
    search?: string;
  }): Promise<{ members: Member[]; total: number; hasMore: boolean }> {
    const { data } = await this.http.get<{ members: Member[]; total: number; hasMore: boolean }>(
      "/api/members",
      { params: filters },
    );
    return data;
  }

  async getMemberBalance(id: string): Promise<{ balance: number; pendingBalance: number }> {
    const { data } = await this.http.get<{ balance: number; pendingBalance: number }>(
      `/api/members/${id}/balance`,
    );
    return data;
  }

  async getMemberTransactions(
    id: string,
    filters: {
      limit?: number;
      type?: "earn" | "burn" | "expire" | "adjust";
      startDate?: string;
      endDate?: string;
    },
  ): Promise<{ transactions: PointTransaction[]; total: number }> {
    const { data } = await this.http.get<{ transactions: PointTransaction[]; total: number }>(
      `/api/members/${id}/transactions`,
      { params: filters },
    );
    return data;
  }

  async adjustMemberPoints(
    id: string,
    amount: number,
    note: string,
    idempotencyKey?: string,
  ): Promise<{ newBalance: number; transactionId: string }> {
    const config: AxiosRequestConfig = {};
    if (idempotencyKey) {
      config.headers = { "Idempotency-Key": idempotencyKey };
    }
    const { data } = await this.http.post<{ newBalance: number; transactionId: string }>(
      `/api/members/${id}/points/adjust`,
      { amount, note },
      config,
    );
    return data;
  }

  async getMemberBadges(
    id: string,
    includeProgress?: boolean,
  ): Promise<{ earned: Badge[]; inProgress: BadgeProgress[] }> {
    const { data } = await this.http.get<{ earned: Badge[]; inProgress: BadgeProgress[] }>(
      `/api/members/${id}/badges`,
      { params: { includeProgress } },
    );
    return data;
  }

  // ── Campaigns ──

  async createCampaign(payload: {
    name: string;
    type: string;
    startDate: string;
    endDate?: string;
    segmentId?: string;
    rules: Record<string, unknown>;
    stackable?: boolean;
    budgetCap?: number;
    status?: "draft" | "active";
  }): Promise<{ campaignId: string; status: string; estimatedReach: number }> {
    const { data } = await this.http.post<{
      campaignId: string;
      status: string;
      estimatedReach: number;
    }>("/api/admin/campaigns", payload);
    return data;
  }

  async listCampaigns(filters: {
    status?: "active" | "draft" | "paused" | "ended";
    limit?: number;
    offset?: number;
  }): Promise<{ campaigns: Campaign[]; total: number }> {
    const { data } = await this.http.get<{ campaigns: Campaign[]; total: number }>(
      "/api/admin/campaigns",
      { params: filters },
    );
    return data;
  }

  async getCampaign(id: string): Promise<Campaign> {
    const { data } = await this.http.get<Campaign>(`/api/admin/campaigns/${id}`);
    return data;
  }

  async activateCampaign(
    id: string,
  ): Promise<{ campaignId: string; status: "active"; activatedAt: string }> {
    const { data } = await this.http.post<{
      campaignId: string;
      status: "active";
      activatedAt: string;
    }>(`/api/admin/campaigns/${id}/activate`);
    return data;
  }

  async pauseCampaign(
    id: string,
    reason?: string,
  ): Promise<{ campaignId: string; status: "paused" }> {
    const { data } = await this.http.post<{ campaignId: string; status: "paused" }>(
      `/api/admin/campaigns/${id}/pause`,
      { reason },
    );
    return data;
  }

  // ── Segments ──

  async createSegment(payload: {
    name: string;
    description?: string;
    rules: { field: string; operator: string; value?: unknown }[];
    logic?: "AND" | "OR";
  }): Promise<{ segmentId: string; estimatedSize: number }> {
    const { data } = await this.http.post<{ segmentId: string; estimatedSize: number }>(
      "/api/admin/segments",
      payload,
    );
    return data;
  }

  async listSegments(): Promise<{ segments: Segment[] }> {
    const { data } = await this.http.get<{ segments: Segment[] }>("/api/admin/segments");
    return data;
  }

  async previewSegment(payload: {
    rules: { field: string; operator: string; value?: unknown }[];
    logic?: "AND" | "OR";
    sampleSize?: number;
  }): Promise<{ estimatedCount: number; sampleMembers: Member[] }> {
    const { data } = await this.http.post<{ estimatedCount: number; sampleMembers: Member[] }>(
      "/api/admin/segments/preview",
      payload,
    );
    return data;
  }

  async getSegmentMembers(id: string): Promise<{ members: Member[]; total: number }> {
    const { data } = await this.http.get<{ members: Member[]; total: number }>(
      `/api/admin/segments/${id}/members`,
    );
    return data;
  }

  // ── Analytics ──

  async getDashboard(period: "7d" | "30d" | "90d" | "365d"): Promise<AnalyticsDashboard> {
    const { data } = await this.http.get<AnalyticsDashboard>("/api/admin/stats/dashboard", {
      params: { period },
    });
    return data;
  }

  async getCampaignStats(id: string, period?: "7d" | "30d" | "all"): Promise<CampaignAnalytics> {
    const { data } = await this.http.get<CampaignAnalytics>(`/api/admin/campaigns/${id}/stats`, {
      params: { period },
    });
    return data;
  }

  // ── Coupons ──

  async createCoupon(payload: {
    name: string;
    type: string;
    value: number;
    mode: string;
    code?: string;
    quantity?: number;
    expiresAt?: string;
    minPurchaseAmount?: number;
    maxUsesPerMember?: number;
    segmentId?: string;
  }): Promise<{ couponId: string; codes?: string[]; count: number }> {
    const { data } = await this.http.post<{ couponId: string; codes?: string[]; count: number }>(
      "/api/admin/coupons",
      payload,
    );
    return data;
  }

  async listCoupons(filters: {
    limit?: number;
    offset?: number;
    active?: boolean;
  }): Promise<{ coupons: Coupon[]; total: number }> {
    const { data } = await this.http.get<{ coupons: Coupon[]; total: number }>(
      "/api/admin/coupons",
      { params: filters },
    );
    return data;
  }

  async validateCoupon(code: string): Promise<{ valid: boolean; coupon?: Coupon }> {
    const { data } = await this.http.post<{ valid: boolean; coupon?: Coupon }>(
      "/api/coupons/validate",
      { code },
    );
    return data;
  }

  async getCouponStats(id: string): Promise<{ redemptions: number; pointsBurned: number }> {
    const { data } = await this.http.get<{ redemptions: number; pointsBurned: number }>(
      `/api/admin/coupons/${id}/stats`,
    );
    return data;
  }

  // ── Rewards ──

  async listRewards(filters: {
    limit?: number;
    offset?: number;
    maxCost?: number;
    type?: string;
    availableOnly?: boolean;
  }): Promise<{ rewards: Reward[]; total: number }> {
    const { data } = await this.http.get<{ rewards: Reward[]; total: number }>(
      "/api/admin/rewards",
      { params: filters },
    );
    return data;
  }

  async createReward(payload: {
    name: string;
    description: string;
    type: string;
    pointCost: number;
    stock?: number;
    imageUrl?: string;
    availableFromDate?: string;
    availableUntilDate?: string;
    tierRestriction?: string[];
  }): Promise<{ rewardId: string; name: string }> {
    const { data } = await this.http.post<{ rewardId: string; name: string }>(
      "/api/admin/rewards",
      payload,
    );
    return data;
  }

  async getRedemptionStats(
    rewardId?: string,
    period?: "7d" | "30d" | "90d" | "365d",
  ): Promise<RedemptionStats> {
    const { data } = await this.http.get<RedemptionStats>("/api/admin/rewards/redemption-stats", {
      params: { rewardId, period },
    });
    return data;
  }

  // ── Coalition ──

  async getCoalitionBalance(memberId: string): Promise<CoalitionBalance> {
    const { data } = await this.http.get<CoalitionBalance>(
      `/api/coalition/members/${memberId}/balance`,
    );
    return data;
  }

  async accumulateCoalition(
    memberId: string,
    points: number,
    transactionRef: string,
    metadata?: Record<string, unknown>,
  ): Promise<CoalitionTxResult> {
    const config: AxiosRequestConfig = {
      headers: { "Idempotency-Key": transactionRef },
    };
    const { data } = await this.http.post<CoalitionTxResult>(
      "/api/coalition/accumulate",
      { memberId, points, metadata },
      config,
    );
    return data;
  }

  async convertCoalition(memberId: string, ownPoints: number): Promise<CoalitionConvertResult> {
    const { data } = await this.http.post<CoalitionConvertResult>("/api/coalition/convert", {
      memberId,
      ownPoints,
    });
    return data;
  }

  // ── Gift Cards ──

  async createGiftCardBatch(payload: {
    name: string;
    quantity: number;
    initialAmount: number;
    currency: string;
    prefix?: string;
    expirationDate: string;
    termsTemplateId: string;
  }): Promise<Record<string, unknown>> {
    const { data } = await this.http.post<Record<string, unknown>>(
      "/api/v1/admin/giftcards/batches",
      payload,
    );
    return data;
  }

  async getGiftCardBatch(batchId: string): Promise<Record<string, unknown>> {
    const { data } = await this.http.get<Record<string, unknown>>(
      `/api/v1/admin/giftcards/batches/${batchId}`,
    );
    return data;
  }

  async redeemGiftCard(
    code: string,
    payload: { amount: number; memberId?: string; orderRef?: string },
  ): Promise<Record<string, unknown>> {
    const idempotencyKey = crypto.randomUUID();
    const config: AxiosRequestConfig = {
      headers: { "Idempotency-Key": idempotencyKey },
    };
    const { data } = await this.http.post<Record<string, unknown>>(
      `/api/v1/giftcards/${encodeURIComponent(code)}/redeem`,
      payload,
      config,
    );
    return data;
  }

  async lookupGiftCard(code: string): Promise<Record<string, unknown>> {
    const { data } = await this.http.post<Record<string, unknown>>(
      `/api/v1/giftcards/${encodeURIComponent(code)}/validate`,
    );
    return data;
  }

  // ── Program ──

  async getProgramConfig(): Promise<ProgramConfig> {
    const { data } = await this.http.get<ProgramConfig>("/api/admin/program/config");
    return data;
  }

  async listWebhooks(): Promise<{ webhooks: Webhook[] }> {
    const { data } = await this.http.get<{ webhooks: Webhook[] }>("/api/admin/webhooks");
    return data;
  }
}

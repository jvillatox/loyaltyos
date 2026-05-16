import type { Coupon, CouponMode } from "@prisma/client";

export type { CouponDiscountType, CouponMode } from "@prisma/client";

export interface CouponCreateInput {
  programId: string;
  code: string;
  mode: CouponMode;
  discountType: Coupon["discountType"];
  discountValue?: number;
  minPurchase?: number;
  maxUses?: number;
  maxUsesPerMember?: number;
  isStackable?: boolean;
  channels?: string[];
  startsAt?: Date;
  expiresAt?: Date;
}

export type CouponUpdateInput = Partial<Omit<CouponCreateInput, "programId" | "code" | "mode">>;

export interface CouponValidateContext {
  memberId: string;
  purchaseAmount?: number;
  channel?: string;
}

export interface ValidateResult {
  valid: boolean;
  reason?: string;
  coupon: CouponWithRedemptions;
  discountAmount?: number;
}

export interface RedeemResult {
  redemptionId: string;
  couponId: string;
  memberId: string;
  discountValue?: number;
  discountAmount?: number;
}

export interface GenerateCodesInput {
  programId: string;
  prefix?: string;
  count: number;
  length?: number;
  discountType: Coupon["discountType"];
  discountValue?: number;
  minPurchase?: number;
  maxUses?: number;
  maxUsesPerMember?: number;
  isStackable?: boolean;
  channels?: string[];
  startsAt?: Date;
  expiresAt?: Date;
}

export type CouponWithRedemptions = Coupon & {
  redemptions: { id: string; memberId: string }[];
};

export class CouponNotFoundError extends Error {
  constructor(code: string) {
    super(`Coupon "${code}" not found`);
    this.name = "CouponNotFoundError";
  }
}

export class CouponExpiredError extends Error {
  constructor(code: string) {
    super(`Coupon "${code}" has expired`);
    this.name = "CouponExpiredError";
  }
}

export class CouponNotStartedError extends Error {
  constructor(code: string) {
    super(`Coupon "${code}" has not started yet`);
    this.name = "CouponNotStartedError";
  }
}

export class CouponExhaustedError extends Error {
  constructor(code: string) {
    super(`Coupon "${code}" has reached its usage limit`);
    this.name = "CouponExhaustedError";
  }
}

export class CouponMemberLimitError extends Error {
  constructor(code: string, memberId: string) {
    super(`Member "${memberId}" has exceeded usage limit for coupon "${code}"`);
    this.name = "CouponMemberLimitError";
  }
}

export class CouponMinPurchaseError extends Error {
  constructor(code: string, required: number) {
    super(`Coupon "${code}" requires minimum purchase of ${String(required)}`);
    this.name = "CouponMinPurchaseError";
  }
}

export class CouponChannelError extends Error {
  constructor(code: string, channel: string) {
    super(`Coupon "${code}" is not valid for channel "${channel}"`);
    this.name = "CouponChannelError";
  }
}

export class CouponCodeDuplicateError extends Error {
  constructor(code: string) {
    super(`Coupon code "${code}" already exists in this program`);
    this.name = "CouponCodeDuplicateError";
  }
}

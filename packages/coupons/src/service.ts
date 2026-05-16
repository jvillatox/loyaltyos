import type { PrismaClient } from "@prisma/client";

import { createRepository } from "./repository.js";
import { couponCreateSchema, couponUpdateSchema, generateCodesSchema } from "./schemas.js";
import type {
  CouponCreateInput,
  CouponUpdateInput,
  CouponValidateContext,
  GenerateCodesInput,
  RedeemResult,
  ValidateResult,
} from "./types.js";
import {
  CouponChannelError,
  CouponCodeDuplicateError,
  CouponExhaustedError,
  CouponExpiredError,
  CouponMemberLimitError,
  CouponMinPurchaseError,
  CouponNotFoundError,
  CouponNotStartedError,
} from "./types.js";

function generateCode(prefix: string, length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code: string = prefix;
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export class CouponsService {
  private repo: ReturnType<typeof createRepository>;

  constructor(prisma: PrismaClient) {
    this.repo = createRepository(prisma);
  }

  async create(input: CouponCreateInput) {
    const parsed = couponCreateSchema.parse(input);
    const exists = await this.repo.checkCodeExists(parsed.programId, parsed.code);
    if (exists) {
      throw new CouponCodeDuplicateError(parsed.code);
    }
    return this.repo.create(parsed);
  }

  async update(id: string, input: CouponUpdateInput) {
    const parsed = couponUpdateSchema.parse(input);
    const coupon = await this.repo.findById(id);
    if (!coupon) throw new CouponNotFoundError(id);
    return this.repo.update(id, parsed);
  }

  async delete(id: string): Promise<void> {
    const coupon = await this.repo.findById(id);
    if (!coupon) throw new CouponNotFoundError(id);
    await this.repo.softDelete(id);
  }

  async getById(id: string) {
    const coupon = await this.repo.findById(id);
    if (!coupon) throw new CouponNotFoundError(id);
    return coupon;
  }

  async getByCode(programId: string, code: string) {
    const coupon = await this.repo.findByCode(programId, code);
    if (!coupon) throw new CouponNotFoundError(code);
    return coupon;
  }

  async list(
    programId: string,
    filters: { isActive?: boolean; mode?: string; page?: number; pageSize?: number },
  ) {
    const { items, total } = await this.repo.findMany(programId, filters);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async generateCodes(input: GenerateCodesInput): Promise<string[]> {
    const parsed = generateCodesSchema.parse(input);
    const { count, length, prefix = "" } = parsed;

    const codes: string[] = [];
    const attempts = count * 3;
    let attempt = 0;

    while (codes.length < count && attempt < attempts) {
      const code = generateCode(prefix, length);
      const exists = await this.repo.checkCodeExists(parsed.programId, code);
      if (!exists) {
        codes.push(code);
      }
      attempt++;
    }

    const inputs: CouponCreateInput[] = codes.map((code) => ({
      programId: parsed.programId,
      code,
      mode: "INDIVIDUAL",
      discountType: parsed.discountType,
      discountValue: parsed.discountValue,
      minPurchase: parsed.minPurchase,
      maxUses: parsed.maxUses,
      maxUsesPerMember: parsed.maxUsesPerMember,
      isStackable: parsed.isStackable,
      channels: parsed.channels,
      startsAt: parsed.startsAt,
      expiresAt: parsed.expiresAt,
    }));

    await this.repo.createMany(inputs);
    return codes;
  }

  async validate(code: string, context: CouponValidateContext): Promise<ValidateResult> {
    const coupon = await this.repo.findByCodeGlobal(code);
    if (!coupon) {
      return { valid: false, reason: "Coupon not found", coupon: null as never };
    }

    const now = new Date();

    if (coupon.startsAt && coupon.startsAt > now) {
      throw new CouponNotStartedError(code);
    }

    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new CouponExpiredError(code);
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      throw new CouponExhaustedError(code);
    }

    if (coupon.maxUsesPerMember) {
      const memberCount = await this.repo.countMemberRedemptions(coupon.id, context.memberId);
      if (memberCount >= coupon.maxUsesPerMember) {
        throw new CouponMemberLimitError(code, context.memberId);
      }
    }

    if (coupon.minPurchase && (context.purchaseAmount ?? 0) < coupon.minPurchase) {
      throw new CouponMinPurchaseError(code, coupon.minPurchase);
    }

    if (
      coupon.channels.length > 0 &&
      context.channel &&
      !coupon.channels.includes(context.channel)
    ) {
      throw new CouponChannelError(code, context.channel);
    }

    let discountAmount: number | undefined;
    if (coupon.discountType === "PERCENTAGE" && coupon.discountValue) {
      discountAmount = Math.round((context.purchaseAmount ?? 0) * (coupon.discountValue / 100));
    } else if (coupon.discountType === "FIXED" && coupon.discountValue) {
      discountAmount = coupon.discountValue;
    }

    return {
      valid: true,
      coupon,
      discountAmount,
    };
  }

  async redeem(code: string, context: CouponValidateContext): Promise<RedeemResult> {
    const validation = await this.validate(code, context);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Coupon validation failed");
    }

    const redemptionId = await this.repo.recordRedemption(validation.coupon.id, context.memberId);

    await this.repo.incrementUsedCount(validation.coupon.id);

    return {
      redemptionId,
      couponId: validation.coupon.id,
      memberId: context.memberId,
      discountValue: validation.coupon.discountValue ?? undefined,
      discountAmount: validation.discountAmount,
    };
  }

  async stats(id: string) {
    const coupon = await this.repo.findById(id);
    if (!coupon) throw new CouponNotFoundError(id);

    return {
      id: coupon.id,
      code: coupon.code,
      usedCount: coupon.usedCount,
      maxUses: coupon.maxUses,
      remaining: coupon.maxUses ? coupon.maxUses - coupon.usedCount : null,
      isActive:
        coupon.deletedAt === null &&
        (!coupon.startsAt || coupon.startsAt <= new Date()) &&
        (!coupon.expiresAt || coupon.expiresAt >= new Date()),
    };
  }
}

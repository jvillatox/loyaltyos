-- Finish converting every business-table reference to a composite FK
-- `(X_id, organizationId) → X(id, organizationId)` (docs/design/tenancy.md §2.6).
-- PRs #88/#89 ADDED the composite FKs but left the original single-column FKs in
-- place, so the database now carries both. This drops the single-column FKs (the
-- composite ones already guarantee the same parent-exists invariant, plus the
-- cross-organization match), and adds the three member edges that were still
-- missing: MemberBadge, MemberDevice and MemberNotificationPreferences.

-- Drop the single-column FKs from the init schema. The composite replacements
-- (added in 20261123000000 / 20261124000000) are the source of truth now.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_programId_fkey";
ALTER TABLE "Badge" DROP CONSTRAINT "Badge_programId_fkey";
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_programId_fkey";
ALTER TABLE "CampaignApplication" DROP CONSTRAINT "CampaignApplication_campaignId_fkey";
ALTER TABLE "CampaignApplication" DROP CONSTRAINT "CampaignApplication_variantId_fkey";
ALTER TABLE "CampaignVariant" DROP CONSTRAINT "CampaignVariant_campaignId_fkey";
ALTER TABLE "CoalitionAccount" DROP CONSTRAINT "CoalitionAccount_memberId_fkey";
ALTER TABLE "CoalitionAccount" DROP CONSTRAINT "CoalitionAccount_programId_fkey";
ALTER TABLE "CoalitionConfig" DROP CONSTRAINT "CoalitionConfig_programId_fkey";
ALTER TABLE "CoalitionTransaction" DROP CONSTRAINT "CoalitionTransaction_accountId_fkey";
ALTER TABLE "Coupon" DROP CONSTRAINT "Coupon_programId_fkey";
ALTER TABLE "CouponRedemption" DROP CONSTRAINT "CouponRedemption_couponId_fkey";
ALTER TABLE "CouponRedemption" DROP CONSTRAINT "CouponRedemption_memberId_fkey";
ALTER TABLE "Event" DROP CONSTRAINT "Event_memberId_fkey";
ALTER TABLE "Event" DROP CONSTRAINT "Event_programId_fkey";
ALTER TABLE "GiftCard" DROP CONSTRAINT "GiftCard_batchId_fkey";
ALTER TABLE "GiftCardBatch" DROP CONSTRAINT "GiftCardBatch_programId_fkey";
ALTER TABLE "GiftCardBatch" DROP CONSTRAINT "GiftCardBatch_termsTemplateId_fkey";
ALTER TABLE "GiftCardTransaction" DROP CONSTRAINT "GiftCardTransaction_giftCardId_fkey";
ALTER TABLE "GiftCardTransaction" DROP CONSTRAINT "GiftCardTransaction_memberId_fkey";
ALTER TABLE "Member" DROP CONSTRAINT "Member_programId_fkey";
ALTER TABLE "MemberBadge" DROP CONSTRAINT "MemberBadge_badgeId_fkey";
ALTER TABLE "MemberBadge" DROP CONSTRAINT "MemberBadge_memberId_fkey";
ALTER TABLE "MemberDevice" DROP CONSTRAINT "MemberDevice_memberId_fkey";
ALTER TABLE "MemberDevice" DROP CONSTRAINT "MemberDevice_programId_fkey";
ALTER TABLE "MemberNotificationPreferences" DROP CONSTRAINT "MemberNotificationPreferences_memberId_fkey";
ALTER TABLE "MemberNotificationPreferences" DROP CONSTRAINT "MemberNotificationPreferences_programId_fkey";
ALTER TABLE "MemberTier" DROP CONSTRAINT "MemberTier_memberId_fkey";
ALTER TABLE "MemberTier" DROP CONSTRAINT "MemberTier_tierId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_memberId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_templateId_fkey";
ALTER TABLE "NotificationTemplate" DROP CONSTRAINT "NotificationTemplate_programId_fkey";
ALTER TABLE "PointAccount" DROP CONSTRAINT "PointAccount_memberId_fkey";
ALTER TABLE "PointAccount" DROP CONSTRAINT "PointAccount_programId_fkey";
ALTER TABLE "PointAdjustmentRequest" DROP CONSTRAINT "PointAdjustmentRequest_memberId_fkey";
ALTER TABLE "PointAdjustmentRequest" DROP CONSTRAINT "PointAdjustmentRequest_programId_fkey";
ALTER TABLE "PointLot" DROP CONSTRAINT "PointLot_accountId_fkey";
ALTER TABLE "PointRule" DROP CONSTRAINT "PointRule_programId_fkey";
ALTER TABLE "PointTransaction" DROP CONSTRAINT "PointTransaction_accountId_fkey";
ALTER TABLE "Reward" DROP CONSTRAINT "Reward_programId_fkey";
ALTER TABLE "RewardRedemption" DROP CONSTRAINT "RewardRedemption_memberId_fkey";
ALTER TABLE "RewardRedemption" DROP CONSTRAINT "RewardRedemption_rewardId_fkey";
ALTER TABLE "Segment" DROP CONSTRAINT "Segment_programId_fkey";
ALTER TABLE "TermsTemplate" DROP CONSTRAINT "TermsTemplate_programId_fkey";
ALTER TABLE "Tier" DROP CONSTRAINT "Tier_programId_fkey";
ALTER TABLE "WebhookSubscription" DROP CONSTRAINT "WebhookSubscription_programId_fkey";

-- One-to-one composite relations need a unique index on the FK columns (Prisma's
-- naming). The single-column `@unique` stays for the standalone key.
CREATE UNIQUE INDEX "CoalitionConfig_programId_organizationId_key" ON "CoalitionConfig"("programId", "organizationId");
CREATE UNIQUE INDEX "PointAccount_memberId_organizationId_key" ON "PointAccount"("memberId", "organizationId");

-- The three remaining member edges. DEFERRABLE INITIALLY DEFERRED like the rest so
-- tenancy:move-program can rewrite Member and its children to a new Organization in
-- one transaction without a transient FK violation.
ALTER TABLE "MemberBadge" ADD CONSTRAINT "MemberBadge_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberNotificationPreferences" ADD CONSTRAINT "MemberNotificationPreferences_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

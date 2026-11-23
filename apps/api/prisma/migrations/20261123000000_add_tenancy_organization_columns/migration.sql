-- Add nullable `organizationId` to every §3.1 business table (docs/design/tenancy.md).
-- This is the expand phase: the column is nullable so existing rows are untouched,
-- and the composite FKs below use Postgres MATCH SIMPLE (the default), so they are
-- NOT enforced while `organizationId` is NULL. A later backfill sets the value and
-- a later PR tightens it to NOT NULL.

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CampaignApplication" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CampaignVariant" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CoalitionAccount" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CoalitionConfig" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CoalitionTransaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "CouponRedemption" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GiftCardBatch" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "GiftCardTransaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MemberBadge" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MemberDevice" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MemberNotificationPreferences" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "MemberTier" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "NotificationTemplate" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PointAccount" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PointAdjustmentRequest" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PointExpiryReminder" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PointLot" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PointRule" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "PointTransaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "RewardRedemption" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Segment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "TermsTemplate" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Tier" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "WebhookSubscription" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex (parents that back the composite FKs below need (id, organizationId) unique)
CREATE UNIQUE INDEX "Badge_id_organizationId_key" ON "Badge"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_organizationId_key" ON "Campaign"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_id_organizationId_key" ON "Coupon"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardBatch_id_organizationId_key" ON "GiftCardBatch"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_id_organizationId_key" ON "Member"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_id_organizationId_key" ON "Program"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_id_organizationId_key" ON "Reward"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite FKs (docs/design/tenancy.md §2.6). Added as raw SQL because Prisma cannot
-- express a required composite relation when one scalar (`organizationId`) is nullable
-- during the expand phase. Postgres MATCH SIMPLE means these are inert until the column
-- is backfilled, after which they guarantee child.organizationId matches its parent.
-- They are DEFERRABLE INITIALLY DEFERRED so tenancy:move-program can rewrite Program and
-- all its children to a new organization inside one transaction without a transient FK
-- violation (the check is deferred to COMMIT).

-- Program children that cascade on program delete.
ALTER TABLE "PointRule" ADD CONSTRAINT "PointRule_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberNotificationPreferences" ADD CONSTRAINT "MemberNotificationPreferences_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "TermsTemplate" ADD CONSTRAINT "TermsTemplate_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Event" ADD CONSTRAINT "Event_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- Program children that restrict on program delete (plus the five tables whose
-- programId has no Prisma relation: PointTransaction, PointLot, PointExpiryReminder,
-- GiftCardTransaction, CoalitionTransaction).
ALTER TABLE "Member" ADD CONSTRAINT "Member_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointLot" ADD CONSTRAINT "PointLot_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointExpiryReminder" ADD CONSTRAINT "PointExpiryReminder_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "GiftCardBatch" ADD CONSTRAINT "GiftCardBatch_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CoalitionConfig" ADD CONSTRAINT "CoalitionConfig_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CoalitionAccount" ADD CONSTRAINT "CoalitionAccount_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CoalitionTransaction" ADD CONSTRAINT "CoalitionTransaction_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_programId_organizationId_fkey" FOREIGN KEY ("programId","organizationId") REFERENCES "Program"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- Child tables without `programId` derive `organizationId` from their parent.
ALTER TABLE "MemberTier" ADD CONSTRAINT "MemberTier_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CampaignVariant" ADD CONSTRAINT "CampaignVariant_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId","organizationId") REFERENCES "Campaign"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId","organizationId") REFERENCES "Campaign"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_organizationId_fkey" FOREIGN KEY ("couponId","organizationId") REFERENCES "Coupon"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_batchId_organizationId_fkey" FOREIGN KEY ("batchId","organizationId") REFERENCES "GiftCardBatch"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberBadge" ADD CONSTRAINT "MemberBadge_badgeId_organizationId_fkey" FOREIGN KEY ("badgeId","organizationId") REFERENCES "Badge"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_rewardId_organizationId_fkey" FOREIGN KEY ("rewardId","organizationId") REFERENCES "Reward"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

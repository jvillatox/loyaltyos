-- Convert the remaining §3.1 business-table references to composite FKs
-- `(X_id, organizationId) → X(id, organizationId)` (docs/design/tenancy.md §2.6),
-- so a child row can only reference a parent row that lives in the same
-- Organization. This is the sibling of the programId composite FKs added in
-- 20261123000000; it closes the memberId / accountId / tierId / couponId /
-- rewardId / badgeId / campaignId / batchId / termsTemplateId / giftCardId /
-- variantId / templateId edges that were still single-column.

-- Prisma cannot express a required composite relation while one scalar
-- (`organizationId`) is nullable, so these are raw SQL. Every referenced table
-- below gains a `(id, organizationId)` unique index (matching Prisma's naming)
-- as the FK target; `@@unique([id, organizationId])` was added to the schema in
-- the same change so Prisma does not report drift.

-- Unique indexes on the newly-referenced parents.
CREATE UNIQUE INDEX "PointAccount_id_organizationId_key" ON "PointAccount"("id", "organizationId");
CREATE UNIQUE INDEX "Tier_id_organizationId_key" ON "Tier"("id", "organizationId");
CREATE UNIQUE INDEX "CampaignVariant_id_organizationId_key" ON "CampaignVariant"("id", "organizationId");
CREATE UNIQUE INDEX "NotificationTemplate_id_organizationId_key" ON "NotificationTemplate"("id", "organizationId");
CREATE UNIQUE INDEX "CoalitionAccount_id_organizationId_key" ON "CoalitionAccount"("id", "organizationId");
CREATE UNIQUE INDEX "TermsTemplate_id_organizationId_key" ON "TermsTemplate"("id", "organizationId");
CREATE UNIQUE INDEX "GiftCard_id_organizationId_key" ON "GiftCard"("id", "organizationId");

-- Non-SetNull references: mirror the existing single-column FK's ON DELETE.
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_accountId_organizationId_fkey" FOREIGN KEY ("accountId","organizationId") REFERENCES "PointAccount"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointLot" ADD CONSTRAINT "PointLot_accountId_organizationId_fkey" FOREIGN KEY ("accountId","organizationId") REFERENCES "PointAccount"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MemberTier" ADD CONSTRAINT "MemberTier_tierId_organizationId_fkey" FOREIGN KEY ("tierId","organizationId") REFERENCES "Tier"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CoalitionAccount" ADD CONSTRAINT "CoalitionAccount_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CoalitionTransaction" ADD CONSTRAINT "CoalitionTransaction_accountId_organizationId_fkey" FOREIGN KEY ("accountId","organizationId") REFERENCES "CoalitionAccount"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "GiftCardBatch" ADD CONSTRAINT "GiftCardBatch_termsTemplateId_organizationId_fkey" FOREIGN KEY ("termsTemplateId","organizationId") REFERENCES "TermsTemplate"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_organizationId_fkey" FOREIGN KEY ("giftCardId","organizationId") REFERENCES "GiftCard"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- SetNull references (onDelete: SetNull in the schema). A composite FK with
-- ON DELETE SET NULL would also null `organizationId`, and PostgreSQL 14 has no
-- `SET NULL (columns)`. Instead each uses ON DELETE NO ACTION (deferred) for the
-- cross-org guarantee plus a BEFORE DELETE trigger that nulls only the FK column,
-- leaving `organizationId` intact. The trigger runs before the deferred NO ACTION
-- check, so the delete is not blocked.

ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_variantId_organizationId_fkey" FOREIGN KEY ("variantId","organizationId") REFERENCES "CampaignVariant"("id","organizationId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Event" ADD CONSTRAINT "Event_memberId_organizationId_fkey" FOREIGN KEY ("memberId","organizationId") REFERENCES "Member"("id","organizationId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_templateId_organizationId_fkey" FOREIGN KEY ("templateId","organizationId") REFERENCES "NotificationTemplate"("id","organizationId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- SetNull consistency triggers (docs/design/tenancy.md §2.6).
CREATE FUNCTION "tenancy_member_setnull_children"() RETURNS trigger AS $$
BEGIN
  UPDATE "Event" SET "memberId" = NULL WHERE "memberId" = OLD."id";
  UPDATE "GiftCardTransaction" SET "memberId" = NULL WHERE "memberId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Member_tenancy_setnull_children"
BEFORE DELETE ON "Member"
FOR EACH ROW EXECUTE FUNCTION "tenancy_member_setnull_children"();

CREATE FUNCTION "tenancy_campaignvariant_setnull_children"() RETURNS trigger AS $$
BEGIN
  UPDATE "CampaignApplication" SET "variantId" = NULL WHERE "variantId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CampaignVariant_tenancy_setnull_children"
BEFORE DELETE ON "CampaignVariant"
FOR EACH ROW EXECUTE FUNCTION "tenancy_campaignvariant_setnull_children"();

CREATE FUNCTION "tenancy_notificationtemplate_setnull_children"() RETURNS trigger AS $$
BEGIN
  UPDATE "Notification" SET "templateId" = NULL WHERE "templateId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "NotificationTemplate_tenancy_setnull_children"
BEFORE DELETE ON "NotificationTemplate"
FOR EACH ROW EXECUTE FUNCTION "tenancy_notificationtemplate_setnull_children"();

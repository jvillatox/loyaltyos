-- CreateTable
CREATE TABLE "CampaignApplication" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variantId" TEXT,
    "memberId" TEXT NOT NULL,
    "eventId" TEXT,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignApplication_campaignId_idx" ON "CampaignApplication"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignApplication_memberId_idx" ON "CampaignApplication"("memberId");

-- CreateIndex
CREATE INDEX "CampaignApplication_campaignId_memberId_idx" ON "CampaignApplication"("campaignId", "memberId");

-- AddForeignKey
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "CampaignVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

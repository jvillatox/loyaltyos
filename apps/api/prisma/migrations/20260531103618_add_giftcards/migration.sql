-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('pending', 'generating', 'ready', 'partial', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('pending', 'active', 'partially_redeemed', 'depleted', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "GiftCardTxType" AS ENUM ('activate', 'redeem', 'refund', 'cancel', 'expire');

-- CreateTable
CREATE TABLE "TermsTemplate" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es-MX',
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardBatch" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "initialAmount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "prefix" VARCHAR(8),
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "termsTemplateId" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'pending',
    "generationJobId" TEXT,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "initialAmount" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'pending',
    "activatedAt" TIMESTAMP(3),
    "lastRedemptionAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardTransaction" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" "GiftCardTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "memberId" TEXT,
    "orderRef" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TermsTemplate_programId_name_locale_version_key" ON "TermsTemplate"("programId", "name", "locale", "version");

-- CreateIndex
CREATE INDEX "GiftCardBatch_programId_status_idx" ON "GiftCardBatch"("programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE INDEX "GiftCard_batchId_idx" ON "GiftCard"("batchId");

-- CreateIndex
CREATE INDEX "GiftCard_status_expirationDate_idx" ON "GiftCard"("status", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardTransaction_idempotencyKey_key" ON "GiftCardTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_giftCardId_createdAt_idx" ON "GiftCardTransaction"("giftCardId", "createdAt");

-- AddForeignKey
ALTER TABLE "TermsTemplate" ADD CONSTRAINT "TermsTemplate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardBatch" ADD CONSTRAINT "GiftCardBatch_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardBatch" ADD CONSTRAINT "GiftCardBatch_termsTemplateId_fkey" FOREIGN KEY ("termsTemplateId") REFERENCES "TermsTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardBatch" ADD CONSTRAINT "GiftCardBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "GiftCardBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

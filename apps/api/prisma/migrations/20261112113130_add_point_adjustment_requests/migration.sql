-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AdjustmentReasonCategory" AS ENUM ('CUSTOMER_SERVICE', 'ERROR_CORRECTION', 'PROMOTION', 'FRAUD', 'OTHER');

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "adjustOperatorDailyLimit" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "adjustOperatorPerTxLimit" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "adjustServerPerTxLimit" INTEGER NOT NULL DEFAULT 10000;

-- CreateTable
CREATE TABLE "PointAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reasonCategory" "AdjustmentReasonCategory" NOT NULL,
    "comment" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByType" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "transactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_programId_status_idx" ON "PointAdjustmentRequest"("programId", "status");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_memberId_idx" ON "PointAdjustmentRequest"("memberId");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_requestedById_createdAt_idx" ON "PointAdjustmentRequest"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "PointAdjustmentRequest_expiresAt_idx" ON "PointAdjustmentRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointAdjustmentRequest_programId_idempotencyKey_key" ON "PointAdjustmentRequest"("programId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAdjustmentRequest" ADD CONSTRAINT "PointAdjustmentRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

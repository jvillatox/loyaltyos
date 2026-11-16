-- AlterTable
ALTER TABLE "Program" ADD COLUMN "holdDays" INTEGER NOT NULL DEFAULT 10;

-- New programs default to a 10-day hold. Existing programs previously used the
-- service-wide hold of 0 days (earn() credited "balance" immediately), so backfill
-- them to 0 to preserve their current behaviour on upgrade.
UPDATE "Program" SET "holdDays" = 0;

-- AlterTable
ALTER TABLE "PointTransaction" ADD COLUMN "availableAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PointTransaction_availableAt_idx" ON "PointTransaction"("availableAt");

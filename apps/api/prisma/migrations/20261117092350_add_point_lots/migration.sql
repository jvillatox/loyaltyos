-- CreateEnum
CREATE TYPE "ExpiryMode" AS ENUM ('NONE', 'INACTIVITY', 'PER_LOT');

-- AlterTable
ALTER TABLE "PointAccount" ADD COLUMN     "debt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3);

-- Constraint: debt can never be negative.
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_debt_nonnegative" CHECK ("debt" >= 0);

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "expiryChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expiryMode" "ExpiryMode" NOT NULL DEFAULT 'INACTIVITY',
ADD COLUMN     "expiryMonths" INTEGER NOT NULL DEFAULT 12;

-- CreateTable
CREATE TABLE "PointLot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sourceTxId" TEXT,
    "originalAmount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PointLot_original_positive" CHECK ("originalAmount" > 0),
    CONSTRAINT "PointLot_remaining_nonnegative" CHECK ("remaining" >= 0),
    CONSTRAINT "PointLot_remaining_not_exceed_original" CHECK ("remaining" <= "originalAmount")
);

-- CreateIndex
CREATE INDEX "PointLot_accountId_expiresAt_idx" ON "PointLot"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "PointLot_accountId_createdAt_idx" ON "PointLot"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PointLot_expiresAt_idx" ON "PointLot"("expiresAt");

-- AddForeignKey
ALTER TABLE "PointLot" ADD CONSTRAINT "PointLot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data backfill: reproduce the current (v1.7.0) state under the new lot model.

-- Existing programs previously never expired. Backfill them to NONE so nothing
-- changes on upgrade; only new programs get the INACTIVITY default.
UPDATE "Program" SET "expiryMode" = 'NONE';

-- Every positive spendable balance becomes a single never-expiring legacy lot.
INSERT INTO "PointLot" ("id", "accountId", "programId", "sourceTxId", "originalAmount", "remaining", "expiresAt", "createdAt")
SELECT gen_random_uuid()::text, "id", "programId", NULL, "balance", "balance", NULL, NOW()
FROM "PointAccount"
WHERE "balance" > 0;

-- Already-negative balances (only reachable today via reversing spent points)
-- become debt; the account holds no lot.
UPDATE "PointAccount" SET "debt" = -"balance" WHERE "balance" < 0;

-- lastActivityAt is the latest earn or redeem (admin adjustments are not activity).
UPDATE "PointAccount" AS pa
SET "lastActivityAt" = sub."lastActivity"
FROM (
  SELECT "accountId", MAX("createdAt") AS "lastActivity"
  FROM "PointTransaction"
  WHERE "type" IN ('EARN', 'REDEEM')
  GROUP BY "accountId"
) AS sub
WHERE sub."accountId" = pa."id";

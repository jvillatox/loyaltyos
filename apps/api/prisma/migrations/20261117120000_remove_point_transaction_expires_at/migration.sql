-- Expiry is now driven by PointLot.expiresAt (PER_LOT) and PointAccount activity
-- (INACTIVITY), so the legacy per-EARN expiry column is no longer needed.

-- DropIndex
DROP INDEX "PointTransaction_expiresAt_idx";

-- AlterTable
ALTER TABLE "PointTransaction" DROP COLUMN "expiresAt";

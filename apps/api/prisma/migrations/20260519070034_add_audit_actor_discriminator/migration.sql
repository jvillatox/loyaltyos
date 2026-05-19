-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN_USER', 'API_KEY', 'SYSTEM');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorId" TEXT NOT NULL DEFAULT 'legacy-unknown',
ADD COLUMN     "actorType" "AuditActorType" NOT NULL DEFAULT 'API_KEY';

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");

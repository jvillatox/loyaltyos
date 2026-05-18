-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- AlterEnum
ALTER TYPE "NotificationStatus" ADD VALUE 'SKIPPED_OPT_OUT';

-- AlterTable
ALTER TABLE "NotificationTemplate" ADD COLUMN     "fallbackChannel" "NotificationChannel",
ADD COLUMN     "transactional" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MemberDevice" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberNotificationPreferences" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberNotificationPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberDevice_token_key" ON "MemberDevice"("token");

-- CreateIndex
CREATE INDEX "MemberDevice_memberId_programId_idx" ON "MemberDevice"("memberId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberNotificationPreferences_memberId_programId_channel_key" ON "MemberNotificationPreferences"("memberId", "programId", "channel");

-- AddForeignKey
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNotificationPreferences" ADD CONSTRAINT "MemberNotificationPreferences_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNotificationPreferences" ADD CONSTRAINT "MemberNotificationPreferences_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

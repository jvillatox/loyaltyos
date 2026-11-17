-- CreateTable
CREATE TABLE "PointExpiryReminder" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointExpiryReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointExpiryReminder_programId_expiresOn_idx" ON "PointExpiryReminder"("programId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "PointExpiryReminder_memberId_programId_expiresOn_key" ON "PointExpiryReminder"("memberId", "programId", "expiresOn");

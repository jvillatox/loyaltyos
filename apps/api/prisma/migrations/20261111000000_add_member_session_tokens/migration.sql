-- CreateTable
CREATE TABLE "MemberSessionToken" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberSessionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberSessionToken_tokenHash_key" ON "MemberSessionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberSessionToken_memberId_programId_idx" ON "MemberSessionToken"("memberId", "programId");

-- CreateIndex
CREATE INDEX "MemberSessionToken_expiresAt_idx" ON "MemberSessionToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "MemberSessionToken" ADD CONSTRAINT "MemberSessionToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

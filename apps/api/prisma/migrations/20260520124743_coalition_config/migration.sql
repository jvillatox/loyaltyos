/*
  Warnings:

  - You are about to drop the column `error` on the `CoalitionTransaction` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CoalitionTransaction" DROP COLUMN "error",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastError" TEXT;

-- CreateTable
CREATE TABLE "CoalitionConfig" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GENERIC',
    "endpoint" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "accumulationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "redemptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "conversionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minConversionPoints" INTEGER NOT NULL DEFAULT 500,
    "circuitState" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoalitionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoalitionConfig_programId_key" ON "CoalitionConfig"("programId");

-- AddForeignKey
ALTER TABLE "CoalitionConfig" ADD CONSTRAINT "CoalitionConfig_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

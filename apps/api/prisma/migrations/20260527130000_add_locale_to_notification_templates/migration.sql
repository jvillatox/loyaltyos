-- AlterTable
ALTER TABLE "NotificationTemplate" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'es-MX';

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_programId_name_locale_key" ON "NotificationTemplate"("programId", "name", "locale");

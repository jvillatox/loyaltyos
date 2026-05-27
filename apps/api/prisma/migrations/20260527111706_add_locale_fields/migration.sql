-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'es-MX';

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "locale" TEXT;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "defaultLocale" TEXT NOT NULL DEFAULT 'es-MX',
ADD COLUMN     "supportedLocales" TEXT[] DEFAULT ARRAY['es-MX', 'en-US']::TEXT[];

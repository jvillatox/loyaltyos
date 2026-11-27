-- PR 7: AdminSession.userId switches from AdminUser to the tenancy identity root
-- User (docs/design/tenancy.md §7 row 7). Existing sessions are remapped to the
-- User that mirrors their AdminUser by email; sessions whose AdminUser never
-- migrated into the identity tables are deleted (they cannot be revalidated).

-- Drop the old FK so userId can be remapped onto User rows.
ALTER TABLE "AdminSession" DROP CONSTRAINT "AdminSession_userId_fkey";

-- The active org/program scope selection is persisted on the session; null means
-- "resolve from the default membership" (pre-migration sessions).
ALTER TABLE "AdminSession" ADD COLUMN "activeOrganizationId" TEXT;
ALTER TABLE "AdminSession" ADD COLUMN "activeProgramId" TEXT;

-- Remap each session to the User.id whose email matches its AdminUser.email
-- (both emails are unique, so this is a deterministic 1:1 mapping).
UPDATE "AdminSession" AS s
SET "userId" = u."id"
FROM "AdminUser" AS a
JOIN "User" AS u ON u."email" = a."email"
WHERE s."userId" = a."id";

-- Delete any session still pointing at a live AdminUser.id (no matching User).
DELETE FROM "AdminSession" AS s
USING "AdminUser" AS a
WHERE s."userId" = a."id";

-- Recreate the FK against User.
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

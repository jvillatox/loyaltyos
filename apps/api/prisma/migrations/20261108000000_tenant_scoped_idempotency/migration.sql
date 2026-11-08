-- Drop the globally-unique idempotency constraints so the same key can be
-- reused across programs. The compound unique index scopes the key per tenant.
DROP INDEX "CoalitionTransaction_idempotencyKey_key";
DROP INDEX "CoalitionTransaction_idempotencyKey_idx";
DROP INDEX "Event_idempotencyKey_key";
DROP INDEX "Event_idempotencyKey_idx";
DROP INDEX "PointTransaction_idempotencyKey_key";
DROP INDEX "PointTransaction_idempotencyKey_idx";

-- Add the denormalized programId column (nullable first, then backfilled).
ALTER TABLE "CoalitionTransaction" ADD COLUMN "programId" TEXT;
ALTER TABLE "PointTransaction" ADD COLUMN "programId" TEXT;

UPDATE "CoalitionTransaction" ct
SET "programId" = ca."programId"
FROM "CoalitionAccount" ca
WHERE ca."id" = ct."accountId";

UPDATE "PointTransaction" pt
SET "programId" = pa."programId"
FROM "PointAccount" pa
WHERE pa."id" = pt."accountId";

ALTER TABLE "CoalitionTransaction" ALTER COLUMN "programId" SET NOT NULL;
ALTER TABLE "PointTransaction" ALTER COLUMN "programId" SET NOT NULL;

-- Tenant-scoped idempotency.
CREATE UNIQUE INDEX "CoalitionTransaction_programId_idempotencyKey_key"
  ON "CoalitionTransaction"("programId", "idempotencyKey");

CREATE UNIQUE INDEX "Event_programId_idempotencyKey_key"
  ON "Event"("programId", "idempotencyKey");

CREATE UNIQUE INDEX "PointTransaction_programId_idempotencyKey_key"
  ON "PointTransaction"("programId", "idempotencyKey");

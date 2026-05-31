-- Drop the global unique index on idempotencyKey
DROP INDEX IF EXISTS "GiftCardTransaction_idempotencyKey_key";

-- Add idempotencyPayloadHash column
ALTER TABLE "GiftCardTransaction"
  ADD COLUMN "idempotencyPayloadHash" TEXT;

-- Add programId column (nullable first, then backfill, then set NOT NULL)
ALTER TABLE "GiftCardTransaction"
  ADD COLUMN "programId" TEXT;

-- Backfill programId from GiftCard -> GiftCardBatch -> programId
UPDATE "GiftCardTransaction" t
SET "programId" = b."programId"
FROM "GiftCard" c
JOIN "GiftCardBatch" b ON b."id" = c."batchId"
WHERE t."giftCardId" = c."id"
  AND t."programId" IS NULL;

-- Now make programId NOT NULL
ALTER TABLE "GiftCardTransaction"
  ALTER COLUMN "programId" SET NOT NULL;

-- Add compound unique constraint
CREATE UNIQUE INDEX "GiftCardTransaction_programId_idempotencyKey_key"
  ON "GiftCardTransaction" ("programId", "idempotencyKey");

-- Add index on idempotencyPayloadHash
CREATE INDEX "GiftCardTransaction_idempotencyPayloadHash_idx"
  ON "GiftCardTransaction" ("idempotencyPayloadHash");

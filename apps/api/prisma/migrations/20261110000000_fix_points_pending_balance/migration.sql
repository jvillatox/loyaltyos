-- Before this release, earn() added points to both "balance" and
-- "pendingBalance", and nothing ever settled pending points, so
-- "pendingBalance" double-counted points that were already spendable.
-- All existing points were credited to "balance" immediately, so:
--   1. clear the double-counted pending balances;
--   2. mark existing transactions as settled (expiry and settlement now
--      only consider settled earns).
UPDATE "PointAccount" SET "pendingBalance" = 0 WHERE "pendingBalance" <> 0;

UPDATE "PointTransaction" SET "settledAt" = "createdAt" WHERE "settledAt" IS NULL;

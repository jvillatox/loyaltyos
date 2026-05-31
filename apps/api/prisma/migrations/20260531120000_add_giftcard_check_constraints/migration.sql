-- Add CHECK constraints to GiftCard
ALTER TABLE "GiftCard"
  ADD CONSTRAINT "GiftCard_balance_nonneg" CHECK ("balance" >= 0),
  ADD CONSTRAINT "GiftCard_balance_lte_initial" CHECK ("balance" <= "initialAmount"),
  ADD CONSTRAINT "GiftCard_initialAmount_positive" CHECK ("initialAmount" > 0);

-- Add CHECK constraint to GiftCardTransaction
ALTER TABLE "GiftCardTransaction"
  ADD CONSTRAINT "GiftCardTransaction_amount_nonneg" CHECK ("amount" >= 0);

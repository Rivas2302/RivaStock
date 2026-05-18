-- 0008_quote_discount_constraints.sql
-- Prevent negative totals and out-of-range discounts at the DB level.

ALTER TABLE quotes
  ADD CONSTRAINT quotes_discount_range CHECK (discount >= 0 AND discount <= 100);

ALTER TABLE quotes
  ADD CONSTRAINT quotes_total_nonneg CHECK (total >= 0);

ALTER TABLE quotes
  ADD CONSTRAINT quotes_subtotal_nonneg CHECK (subtotal >= 0);

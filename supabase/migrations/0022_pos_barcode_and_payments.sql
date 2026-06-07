-- 0022_pos_barcode_and_payments.sql
-- POS feature: add products.barcode (unique per owner where not null),
-- and extend payment_method CHECK to include 'Débito' and 'Crédito'
-- on sales, cash_flow and customer_transactions.

BEGIN;

-- ── 1. PRODUCTS.barcode ──────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode text;

-- Unique per owner only when set (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS products_user_barcode_unique_idx
  ON products (user_id, barcode)
  WHERE barcode IS NOT NULL;

-- Lookup index for the POS scanner
CREATE INDEX IF NOT EXISTS products_user_barcode_idx
  ON products (user_id, barcode);

-- ── 2. PAYMENT METHODS — sales ───────────────────────────────────────────────
ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales
  ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('Efectivo','Transferencia','Débito','Crédito','Otro'));

-- ── 3. PAYMENT METHODS — cash_flow ───────────────────────────────────────────
ALTER TABLE cash_flow
  DROP CONSTRAINT IF EXISTS cash_flow_payment_method_check;
ALTER TABLE cash_flow
  ADD CONSTRAINT cash_flow_payment_method_check
  CHECK (payment_method IN ('Efectivo','Transferencia','Débito','Crédito','Otro'));

-- ── 4. PAYMENT METHODS — customer_transactions ───────────────────────────────
ALTER TABLE customer_transactions
  DROP CONSTRAINT IF EXISTS customer_transactions_payment_method_check;
ALTER TABLE customer_transactions
  ADD CONSTRAINT customer_transactions_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('Efectivo','Transferencia','Débito','Crédito','Otro'));

COMMIT;

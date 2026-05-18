-- 0005_fk_product_id.sql
-- Convert sales.product_id and stock_intakes.product_id from text to uuid with FK.

-- 1. Nullify empty strings so the uuid cast won't fail
UPDATE sales SET product_id = NULL WHERE product_id = '';
UPDATE stock_intakes SET product_id = NULL WHERE product_id = '';

-- 2. Change type + add FK on sales (drop DEFAULT first — column may have DEFAULT '')
ALTER TABLE sales ALTER COLUMN product_id DROP DEFAULT;
ALTER TABLE sales
  ALTER COLUMN product_id TYPE uuid USING NULLIF(product_id, '')::uuid;
ALTER TABLE sales
  ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE sales
  ADD CONSTRAINT sales_product_fk
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- 3. Change type + add FK on stock_intakes (drop DEFAULT first)
ALTER TABLE stock_intakes ALTER COLUMN product_id DROP DEFAULT;
ALTER TABLE stock_intakes
  ALTER COLUMN product_id TYPE uuid USING NULLIF(product_id, '')::uuid;
ALTER TABLE stock_intakes
  ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE stock_intakes
  ADD CONSTRAINT stock_intakes_product_fk
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

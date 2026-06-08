-- 0024_sales_source_column.sql
-- Add source column to sales to distinguish origin:
--   'pos'    = created from POS multi-item screen
--   'quote'  = created from a quote conversion
--   'manual' = created from classic single-item modal

BEGIN;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_source_check;
ALTER TABLE sales
  ADD CONSTRAINT sales_source_check
  CHECK (source IS NULL OR source IN ('pos', 'quote', 'manual'));

-- Backfill existing rows:
--   - sales with items[] (non-empty) AND from a quote → 'quote'
--   - sales with items[] (non-empty) AND NOT from a quote → 'pos' (POS sales created before this column)
--   - sales without items → 'manual'
UPDATE sales
   SET source = CASE
     WHEN items IS NOT NULL AND jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 THEN 'pos'
     ELSE 'manual'
   END
 WHERE source IS NULL;

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS sales_user_source_idx ON sales (user_id, source);

COMMIT;

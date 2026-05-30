-- 0022_verify_products_index.sql
-- Idempotently ensures the products(user_id) index that the dashboard's
-- list:products query depends on. The first statement is a no-op on the
-- production database where it was created by 0001_init.sql. The second
-- adds a composite index so the ORDER BY created_at DESC added by db.list
-- in TASK-004 can be served without a sort step.

CREATE INDEX IF NOT EXISTS products_user_id_idx
  ON public.products (user_id);

CREATE INDEX IF NOT EXISTS products_user_id_created_at_idx
  ON public.products (user_id, created_at DESC);

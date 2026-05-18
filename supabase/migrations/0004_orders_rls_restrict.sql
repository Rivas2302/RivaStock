-- 0004_orders_rls_restrict.sql
-- Restrict anonymous order inserts to catalogs that are enabled and allow orders.

DROP POLICY IF EXISTS "orders_public_insert" ON orders;

CREATE POLICY "orders_public_insert" ON orders
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM catalog_config c
      WHERE c.user_id = orders.user_id
        AND c.enabled = true
        AND c.allow_orders = true
    )
  );

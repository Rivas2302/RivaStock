-- The public catalog now reads sanitized projections and creates orders through
-- SECURITY DEFINER RPCs. Remove the legacy direct table access that exposed
-- internal product columns and trusted client-provided order totals.

BEGIN;

DROP POLICY IF EXISTS "products_catalog_public" ON products;
DROP POLICY IF EXISTS "orders_public_insert" ON orders;

REVOKE SELECT ON products FROM anon;
REVOKE INSERT ON orders FROM anon;

COMMIT;

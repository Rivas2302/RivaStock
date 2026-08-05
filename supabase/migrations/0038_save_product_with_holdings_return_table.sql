-- 0038_save_product_with_holdings_return_table.sql
-- Reload PostgREST's schema cache and rewrite save_product_with_holdings
-- to return a tabular shape that PostgREST can always serialize, so the
-- old "cannot extract elements from a scalar" error stops happening
-- whenever the schema cache serves a stale view of the function.
--
-- The new signature:
--   RETURNS TABLE (product jsonb, holdings jsonb)
-- PostgREST serializes a TABLE return as a single row whose columns are
-- JSON values, which is exactly what the old RETURNS jsonb did but
-- without the schema-cache ambiguity around scalar vs SETOF.

BEGIN;

NOTIFY pgrst, 'reload schema';

DROP FUNCTION IF EXISTS save_product_with_holdings(jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION save_product_with_holdings(
  p_product jsonb, p_holdings jsonb, p_idempotency_key text
)
RETURNS TABLE (product jsonb, holdings jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_response jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  PERFORM lock_inventory_commands(v_uid, ARRAY[p_idempotency_key]);
  PERFORM lock_inventory_products(v_uid, ARRAY[(p_product->>'id')::uuid]);
  v_response := save_product_with_holdings_unlocked(p_product, p_holdings, p_idempotency_key);
  RETURN QUERY SELECT v_response->'product', v_response->'holdings';
END;
$$;

REVOKE ALL ON FUNCTION save_product_with_holdings(jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_product_with_holdings(jsonb, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

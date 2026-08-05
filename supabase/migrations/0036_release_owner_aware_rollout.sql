-- 0036_release_owner_aware_rollout.sql
-- Removes the placeholder kill switch that 0033 and 0034 added to
-- set_inventory_holdings_enabled. The rollout is now safe to enable:
-- every frontend writer (POS, Sales, Stock, Intake, transfers) already
-- routes through resolveIdempotencyIntent on the client, and 0034's
-- backfill_attributed_sales() populated sale_items / sale_item_allocations
-- for the existing sales so the read model is complete.
--
-- The function keeps the same signature, ownership check, and idempotent
-- upsert as 0032. The only change is the removal of
--   IF p_enabled THEN RAISE EXCEPTION '...'
-- which was a guard that has since become a blocker.

BEGIN;

CREATE OR REPLACE FUNCTION set_inventory_holdings_enabled(p_enabled boolean)
RETURNS inventory_operation_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_row inventory_operation_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticación requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'config', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar la configuración';
  END IF;
  INSERT INTO inventory_operation_settings (user_id, holdings_enabled, updated_at)
  VALUES (v_uid, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE
    SET holdings_enabled = EXCLUDED.holdings_enabled,
        updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION set_inventory_holdings_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_inventory_holdings_enabled(boolean) TO authenticated;

COMMIT;

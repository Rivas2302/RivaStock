-- 0037_inventory_movements_history.sql
-- Read-only history of every inventory_holding mutation, classified into
-- operator-friendly movement types (intake, transfer_in, transfer_out,
-- adjustment, product_edit) and joined with the resolved product and
-- owner names so the Settings > Titulares > Historial tab can render
-- without a second round-trip.
--
-- The view respects the existing inventory_stock_commands_select policy
-- (user_id = get_owner_uid(auth.uid()) AND has_permission(..., 'stock',
-- 'read')) and the SECURITY DEFINER RPC routes every read through
-- get_owner_uid, so collaborators see only the rows their owner can see.

BEGIN;

CREATE OR REPLACE VIEW inventory_movements_view
WITH (security_invoker = true) AS
SELECT
  cmd.id,
  cmd.user_id,
  cmd.created_at,
  cmd.product_id,
  cmd.product_name,
  cmd.actor_uid,
  cmd.delta,
  cmd.reason,
  cmd.resulting_stock,
  cmd.idempotency_key,
  cmd.inventory_owner_id,
  cmd.inventory_owner_name,
  CASE
    WHEN cmd.delta > 0 AND cmd.reason = 'Ingreso de mercadería' THEN 'intake'
    WHEN cmd.delta < 0 AND cmd.reason LIKE '%(transferencia saliente)' THEN 'transfer_out'
    WHEN cmd.delta > 0 AND cmd.reason LIKE '%(transferencia entrante)' THEN 'transfer_in'
    WHEN cmd.reason = 'Edición de producto y existencias' THEN 'product_edit'
    ELSE 'adjustment'
  END AS movement_type,
  CASE
    WHEN cmd.reason LIKE '%(transferencia saliente)%' OR cmd.reason LIKE '%(transferencia entrante)%' THEN
      btrim(regexp_replace(cmd.reason, ' \(transferencia (saliente|entrante)\)$', ''))
    ELSE cmd.reason
  END AS transfer_reason,
  CASE
    WHEN cmd.idempotency_key LIKE '%:out' THEN substring(cmd.idempotency_key FROM 1 FOR char_length(cmd.idempotency_key) - 4)
    WHEN cmd.idempotency_key LIKE '%:in' THEN substring(cmd.idempotency_key FROM 1 FOR char_length(cmd.idempotency_key) - 3)
    ELSE NULL
  END AS transfer_key
FROM inventory_stock_commands cmd;

GRANT SELECT ON inventory_movements_view TO authenticated;

CREATE OR REPLACE FUNCTION list_inventory_movements(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_inventory_owner_id uuid DEFAULT NULL,
  p_movement_type text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  product_id uuid,
  product_name text,
  inventory_owner_id uuid,
  inventory_owner_name text,
  movement_type text,
  delta integer,
  reason text,
  transfer_reason text,
  transfer_key text,
  resulting_stock integer,
  actor_uid uuid,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'stock', 'read') THEN
    RAISE EXCEPTION 'Sin permiso para leer movimientos de stock';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN p_limit := 50; END IF;
  IF p_limit > 200 THEN p_limit := 200; END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN p_offset := 0; END IF;

  SELECT count(*) INTO v_total
  FROM inventory_movements_view m
  WHERE m.user_id = v_uid
    AND (p_date_from IS NULL OR m.created_at >= p_date_from::timestamptz)
    AND (p_date_to IS NULL OR m.created_at < (p_date_to + 1)::timestamptz)
    AND (p_product_id IS NULL OR m.product_id = p_product_id)
    AND (p_inventory_owner_id IS NULL OR m.inventory_owner_id = p_inventory_owner_id)
    AND (p_movement_type IS NULL OR m.movement_type = p_movement_type);

  RETURN QUERY
  SELECT
    m.id, m.created_at, m.product_id, m.product_name,
    m.inventory_owner_id, m.inventory_owner_name,
    m.movement_type, m.delta, m.reason, m.transfer_reason, m.transfer_key,
    m.resulting_stock, m.actor_uid, v_total
  FROM inventory_movements_view m
  WHERE m.user_id = v_uid
    AND (p_date_from IS NULL OR m.created_at >= p_date_from::timestamptz)
    AND (p_date_to IS NULL OR m.created_at < (p_date_to + 1)::timestamptz)
    AND (p_product_id IS NULL OR m.product_id = p_product_id)
    AND (p_inventory_owner_id IS NULL OR m.inventory_owner_id = p_inventory_owner_id)
    AND (p_movement_type IS NULL OR m.movement_type = p_movement_type)
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION list_inventory_movements(
  date, date, uuid, uuid, text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_inventory_movements(
  date, date, uuid, uuid, text, integer, integer
) TO authenticated;

CREATE INDEX IF NOT EXISTS inventory_stock_commands_created_at_idx
  ON inventory_stock_commands (user_id, created_at DESC);

COMMIT;

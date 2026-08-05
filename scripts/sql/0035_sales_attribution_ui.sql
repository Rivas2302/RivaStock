-- 0035_sales_attribution_ui.sql
-- Adds the idempotent attributed-sale status toggle that the Sales UI calls
-- when the owner-aware rollout is enabled. The registration, edit and refund
-- commands already exist in 0034; only this status toggle was missing.
--
-- The rollout remains disabled by default. Toggle it on per user via
-- set_inventory_holdings_enabled(true) once the operator has reviewed the
-- backfill of sale_items / sale_item_allocations.

BEGIN;

UPDATE inventory_operation_settings
SET holdings_enabled = false,
    updated_at = now()
WHERE holdings_enabled;

CREATE OR REPLACE FUNCTION toggle_attributed_sale_status(
  p_sale_id uuid,
  p_new_status text,
  p_idempotency_key text
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_key text := btrim(p_idempotency_key);
  v_payload jsonb;
  v_fingerprint text;
  v_command attributed_sale_commands%ROWTYPE;
  v_sale sales%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida'; END IF;
  IF NOT has_permission(auth.uid(), 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar el estado de ventas';
  END IF;
  IF p_new_status NOT IN ('Pagado', 'Pendiente', 'No Pagado') THEN
    RAISE EXCEPTION 'Estado invalido';
  END IF;
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Clave de idempotencia invalida';
  END IF;

  v_payload := jsonb_build_object('saleId', p_sale_id, 'status', p_new_status);
  v_fingerprint := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  PERFORM lock_inventory_commands(v_uid, ARRAY[v_key]);

  SELECT * INTO v_command
  FROM attributed_sale_commands
  WHERE user_id = v_uid AND idempotency_key = v_key;
  IF v_command.id IS NOT NULL THEN
    PERFORM assert_attributed_sale_access(v_command.sale_id_snapshot, v_uid);
    IF v_command.operation <> 'edit' OR v_command.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos';
    END IF;
    v_sale := jsonb_populate_record(NULL::sales, v_command.result);
    RETURN NEXT v_sale;
    RETURN;
  END IF;

  IF NOT COALESCE((
    SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = v_uid
  ), false) THEN
    RAISE EXCEPTION 'El cambio de estado atribuido requiere stock compartido habilitado';
  END IF;

  PERFORM assert_attributed_sale_access(p_sale_id, v_uid);
  PERFORM lock_attributed_sale_resources(v_uid, NULL, p_sale_id);
  SELECT * INTO v_sale
  FROM sales
  WHERE user_id = v_uid AND id = p_sale_id
  FOR UPDATE;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;
  IF v_sale.source = 'quote' THEN
    RAISE EXCEPTION 'Las ventas originadas en presupuestos se gestionan desde el presupuesto original';
  END IF;

  SELECT * INTO v_sale
  FROM toggle_sale_status_unlocked(p_sale_id, p_new_status)
  LIMIT 1;

  INSERT INTO attributed_sale_commands (
    user_id, idempotency_key, operation, sale_id, sale_id_snapshot,
    actor_uid, payload, request_fingerprint, result
  ) VALUES (
    v_uid, v_key, 'edit', v_sale.id, v_sale.id,
    auth.uid(), v_payload, v_fingerprint, to_jsonb(v_sale)
  );
  RETURN NEXT v_sale;
END;
$$;

REVOKE ALL ON FUNCTION toggle_attributed_sale_status(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION toggle_attributed_sale_status(uuid, text, text)
  TO authenticated;

COMMIT;

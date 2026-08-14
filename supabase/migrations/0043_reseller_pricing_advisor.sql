-- Persist the business targets used by the reseller pricing advisor.

BEGIN;

ALTER TABLE price_lists
  ADD COLUMN minimum_profit_margin_percent numeric NOT NULL DEFAULT 25
    CHECK (minimum_profit_margin_percent BETWEEN 0 AND 95),
  ADD COLUMN target_reseller_discount_percent numeric NOT NULL DEFAULT 15
    CHECK (target_reseller_discount_percent BETWEEN 0 AND 100);

CREATE OR REPLACE FUNCTION configure_reseller_pricing_advisor(
  p_list_id uuid,
  p_minimum_profit_margin_percent numeric,
  p_target_reseller_discount_percent numeric
)
RETURNS price_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_list price_lists;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar listas de precios';
  END IF;
  IF p_minimum_profit_margin_percent < 0 OR p_minimum_profit_margin_percent > 95 THEN
    RAISE EXCEPTION 'El margen minimo debe estar entre 0 y 95';
  END IF;
  IF p_target_reseller_discount_percent < 0 OR p_target_reseller_discount_percent > 100 THEN
    RAISE EXCEPTION 'El descuento objetivo debe estar entre 0 y 100';
  END IF;

  UPDATE price_lists
  SET minimum_profit_margin_percent = p_minimum_profit_margin_percent,
      target_reseller_discount_percent = p_target_reseller_discount_percent,
      updated_at = now()
  WHERE id = p_list_id AND user_id = v_uid AND kind = 'reseller'
  RETURNING * INTO v_list;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'Lista de revendedores no encontrada';
  END IF;

  RETURN v_list;
END;
$$;

REVOKE ALL ON FUNCTION configure_reseller_pricing_advisor(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION configure_reseller_pricing_advisor(uuid, numeric, numeric) TO authenticated;

COMMIT;

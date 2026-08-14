-- Products without stock are not assumed to be available on demand. On-order
-- availability is an explicit commercial decision made from the list editor.

BEGIN;

CREATE OR REPLACE FUNCTION ensure_reseller_price_list(
  p_default_discount numeric DEFAULT 20
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
  IF p_default_discount < 0 OR p_default_discount > 100 THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 100';
  END IF;

  INSERT INTO price_lists (user_id, name, kind, default_discount_percent)
  VALUES (v_uid, 'Revendedores', 'reseller', p_default_discount)
  ON CONFLICT (user_id, kind) DO UPDATE
    SET updated_at = price_lists.updated_at
  RETURNING * INTO v_list;

  INSERT INTO price_list_items (
    user_id, price_list_id, product_id, availability, sort_order
  )
  SELECT
    v_uid,
    v_list.id,
    p.id,
    'in_stock',
    row_number() OVER (ORDER BY p.created_at, p.name)::integer - 1
  FROM products p
  WHERE p.user_id = v_uid
    AND p.stock > 0
  ON CONFLICT (price_list_id, product_id) DO NOTHING;

  RETURN v_list;
END;
$$;

-- Remove the legacy automatic assumptions. Any product actually supplied on
-- demand can be checked again manually in the list editor.
DELETE FROM price_list_items pli
USING products p
WHERE pli.product_id = p.id
  AND pli.user_id = p.user_id
  AND pli.availability = 'on_order'
  AND p.stock <= 0;

REVOKE ALL ON FUNCTION ensure_reseller_price_list(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_reseller_price_list(numeric) TO authenticated;

COMMIT;

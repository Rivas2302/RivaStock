-- Reseller price lists keep one product/inventory record while allowing
-- channel-specific prices and availability (immediate stock or on demand).

CREATE TABLE price_lists (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                     text NOT NULL DEFAULT 'Revendedores',
  kind                     text NOT NULL DEFAULT 'reseller' CHECK (kind IN ('reseller')),
  default_discount_percent numeric NOT NULL DEFAULT 20 CHECK (default_discount_percent BETWEEN 0 AND 100),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);

CREATE TABLE price_list_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  price_list_id    uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pricing_mode     text NOT NULL DEFAULT 'default' CHECK (pricing_mode IN ('default', 'discount', 'fixed')),
  discount_percent numeric CHECK (discount_percent BETWEEN 0 AND 100),
  fixed_price      numeric CHECK (fixed_price >= 0),
  availability     text NOT NULL DEFAULT 'in_stock' CHECK (availability IN ('in_stock', 'on_order')),
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id),
  CHECK (
    (pricing_mode = 'default' AND discount_percent IS NULL AND fixed_price IS NULL)
    OR (pricing_mode = 'discount' AND discount_percent IS NOT NULL AND fixed_price IS NULL)
    OR (pricing_mode = 'fixed' AND fixed_price IS NOT NULL AND discount_percent IS NULL)
  )
);

CREATE INDEX price_lists_user_id_idx ON price_lists(user_id);
CREATE INDEX price_list_items_list_id_idx ON price_list_items(price_list_id, sort_order);
CREATE INDEX price_list_items_product_id_idx ON price_list_items(product_id);

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_lists_select_account" ON price_lists
  FOR SELECT USING (user_id = get_owner_uid(auth.uid()));
CREATE POLICY "price_lists_insert_stock_write" ON price_lists
  FOR INSERT WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "price_lists_update_stock_write" ON price_lists
  FOR UPDATE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  ) WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "price_lists_delete_stock_delete" ON price_lists
  FOR DELETE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'delete')
  );

CREATE POLICY "price_list_items_select_account" ON price_list_items
  FOR SELECT USING (user_id = get_owner_uid(auth.uid()));
CREATE POLICY "price_list_items_insert_stock_write" ON price_list_items
  FOR INSERT WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "price_list_items_update_stock_write" ON price_list_items
  FOR UPDATE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  ) WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "price_list_items_delete_stock_write" ON price_list_items
  FOR DELETE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );

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
    CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'on_order' END,
    row_number() OVER (ORDER BY p.created_at, p.name)::integer - 1
  FROM products p
  WHERE p.user_id = v_uid
  ON CONFLICT (price_list_id, product_id) DO NOTHING;

  RETURN v_list;
END;
$$;

CREATE OR REPLACE FUNCTION save_reseller_price_list(
  p_list_id uuid,
  p_default_discount numeric,
  p_items jsonb
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
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Los productos de la lista no son válidos';
  END IF;

  UPDATE price_lists
  SET default_discount_percent = p_default_discount,
      updated_at = now()
  WHERE id = p_list_id AND user_id = v_uid AND kind = 'reseller'
  RETURNING * INTO v_list;
  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'Lista de revendedores no encontrada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) item
    LEFT JOIN products p
      ON p.id = (item->>'productId')::uuid AND p.user_id = v_uid
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'La lista contiene productos inválidos';
  END IF;

  DELETE FROM price_list_items WHERE price_list_id = p_list_id AND user_id = v_uid;

  INSERT INTO price_list_items (
    user_id, price_list_id, product_id, pricing_mode,
    discount_percent, fixed_price, availability, sort_order
  )
  SELECT
    v_uid,
    p_list_id,
    (item->>'productId')::uuid,
    COALESCE(item->>'pricingMode', 'default'),
    CASE WHEN item->>'pricingMode' = 'discount' THEN (item->>'discountPercent')::numeric ELSE NULL END,
    CASE WHEN item->>'pricingMode' = 'fixed' THEN (item->>'fixedPrice')::numeric ELSE NULL END,
    COALESCE(item->>'availability', 'in_stock'),
    COALESCE((item->>'sortOrder')::integer, 0)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) item;

  RETURN v_list;
END;
$$;

CREATE OR REPLACE FUNCTION add_reseller_price_list_product(
  p_product_id uuid,
  p_availability text DEFAULT 'on_order'
)
RETURNS void
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
  IF p_availability NOT IN ('in_stock', 'on_order') THEN
    RAISE EXCEPTION 'Disponibilidad inválida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  SELECT * INTO v_list
  FROM price_lists
  WHERE user_id = v_uid AND kind = 'reseller';
  IF v_list.id IS NULL THEN
    v_list := ensure_reseller_price_list(20);
  END IF;

  INSERT INTO price_list_items (
    user_id, price_list_id, product_id, availability, sort_order
  ) VALUES (
    v_uid,
    v_list.id,
    p_product_id,
    p_availability,
    COALESCE((SELECT max(sort_order) + 1 FROM price_list_items WHERE price_list_id = v_list.id), 0)
  )
  ON CONFLICT (price_list_id, product_id) DO UPDATE
    SET availability = EXCLUDED.availability,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION ensure_reseller_price_list(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_reseller_price_list(uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_reseller_price_list_product(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_reseller_price_list(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION save_reseller_price_list(uuid, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION add_reseller_price_list_product(uuid, text) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON price_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON price_list_items TO authenticated;

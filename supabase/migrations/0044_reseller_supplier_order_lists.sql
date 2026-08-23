-- Reusable supplier lists let the reseller catalog publish on-order products
-- as a group. Immediate products with no stock are never exposed publicly.

BEGIN;

CREATE TABLE reseller_supplier_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  supplier_id   uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  enabled       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, supplier_id)
);

CREATE TABLE reseller_supplier_list_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  supplier_list_id uuid NOT NULL REFERENCES reseller_supplier_lists(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_list_id, product_id),
  UNIQUE (user_id, product_id)
);

ALTER TABLE price_list_items
  ADD COLUMN supplier_list_id uuid REFERENCES reseller_supplier_lists(id) ON DELETE CASCADE;

CREATE INDEX reseller_supplier_lists_account_idx
  ON reseller_supplier_lists(user_id, price_list_id);
CREATE INDEX reseller_supplier_list_items_list_idx
  ON reseller_supplier_list_items(supplier_list_id, sort_order);
CREATE INDEX price_list_items_supplier_list_idx
  ON price_list_items(supplier_list_id)
  WHERE supplier_list_id IS NOT NULL;

ALTER TABLE reseller_supplier_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE reseller_supplier_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reseller_supplier_lists_select_account" ON reseller_supplier_lists
  FOR SELECT USING (user_id = get_owner_uid(auth.uid()));
CREATE POLICY "reseller_supplier_lists_insert_stock_write" ON reseller_supplier_lists
  FOR INSERT WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "reseller_supplier_lists_update_stock_write" ON reseller_supplier_lists
  FOR UPDATE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  ) WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "reseller_supplier_lists_delete_stock_write" ON reseller_supplier_lists
  FOR DELETE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );

CREATE POLICY "reseller_supplier_list_items_select_account" ON reseller_supplier_list_items
  FOR SELECT USING (user_id = get_owner_uid(auth.uid()));
CREATE POLICY "reseller_supplier_list_items_insert_stock_write" ON reseller_supplier_list_items
  FOR INSERT WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "reseller_supplier_list_items_update_stock_write" ON reseller_supplier_list_items
  FOR UPDATE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  ) WITH CHECK (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );
CREATE POLICY "reseller_supplier_list_items_delete_stock_write" ON reseller_supplier_list_items
  FOR DELETE USING (
    user_id = get_owner_uid(auth.uid())
    AND has_permission(auth.uid(), 'stock', 'write')
  );

CREATE OR REPLACE FUNCTION save_reseller_supplier_list(
  p_list_id uuid,
  p_supplier_id uuid,
  p_product_ids uuid[]
)
RETURNS reseller_supplier_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_supplier_list reseller_supplier_lists;
  v_product_ids uuid[] := COALESCE(p_product_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar listas por proveedor';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM price_lists
    WHERE id = p_list_id AND user_id = v_uid AND kind = 'reseller'
  ) THEN
    RAISE EXCEPTION 'Lista de revendedores no encontrada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE id = p_supplier_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Proveedor no encontrado';
  END IF;
  IF cardinality(v_product_ids) > 500 THEN
    RAISE EXCEPTION 'La lista no puede superar 500 productos';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_product_ids) product_id
    LEFT JOIN products p ON p.id = product_id AND p.user_id = v_uid
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'La lista contiene productos inválidos';
  END IF;

  INSERT INTO reseller_supplier_lists (user_id, price_list_id, supplier_id)
  VALUES (v_uid, p_list_id, p_supplier_id)
  ON CONFLICT (price_list_id, supplier_id) DO UPDATE
    SET updated_at = now()
  RETURNING * INTO v_supplier_list;

  -- A product belongs to one supplier order list. Reassigning it must also
  -- remove any currently published item managed by its previous list.
  DELETE FROM price_list_items pli
  WHERE pli.user_id = v_uid
    AND pli.product_id = ANY(v_product_ids)
    AND pli.supplier_list_id IN (
      SELECT other_list.id
      FROM reseller_supplier_lists other_list
      WHERE other_list.user_id = v_uid
        AND other_list.id <> v_supplier_list.id
    );

  DELETE FROM reseller_supplier_list_items item
  WHERE item.user_id = v_uid
    AND item.product_id = ANY(v_product_ids)
    AND item.supplier_list_id <> v_supplier_list.id;

  DELETE FROM reseller_supplier_list_items
  WHERE supplier_list_id = v_supplier_list.id;

  INSERT INTO reseller_supplier_list_items (
    user_id, supplier_list_id, product_id, sort_order
  )
  SELECT
    v_uid,
    v_supplier_list.id,
    selected.product_id,
    min(selected.position)::integer - 1
  FROM unnest(v_product_ids) WITH ORDINALITY AS selected(product_id, position)
  GROUP BY selected.product_id;

  DELETE FROM price_list_items
  WHERE supplier_list_id = v_supplier_list.id
    AND NOT (product_id = ANY(v_product_ids));

  IF v_supplier_list.enabled THEN
    INSERT INTO price_list_items (
      user_id, price_list_id, product_id, availability, sort_order, supplier_list_id
    )
    SELECT
      v_uid,
      p_list_id,
      item.product_id,
      'on_order',
      COALESCE((SELECT max(sort_order) + 1 FROM price_list_items WHERE price_list_id = p_list_id), 0)
        + item.sort_order,
      v_supplier_list.id
    FROM reseller_supplier_list_items item
    WHERE item.supplier_list_id = v_supplier_list.id
    ON CONFLICT (price_list_id, product_id) DO UPDATE
      SET availability = 'on_order',
          supplier_list_id = EXCLUDED.supplier_list_id,
          updated_at = now();
  END IF;

  RETURN v_supplier_list;
END;
$$;

CREATE OR REPLACE FUNCTION toggle_reseller_supplier_list(
  p_supplier_list_id uuid,
  p_enabled boolean
)
RETURNS reseller_supplier_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_supplier_list reseller_supplier_lists;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar listas por proveedor';
  END IF;

  UPDATE reseller_supplier_lists
  SET enabled = COALESCE(p_enabled, false),
      updated_at = now()
  WHERE id = p_supplier_list_id AND user_id = v_uid
  RETURNING * INTO v_supplier_list;
  IF v_supplier_list.id IS NULL THEN
    RAISE EXCEPTION 'Lista por proveedor no encontrada';
  END IF;

  IF v_supplier_list.enabled THEN
    INSERT INTO price_list_items (
      user_id, price_list_id, product_id, availability, sort_order, supplier_list_id
    )
    SELECT
      v_uid,
      v_supplier_list.price_list_id,
      item.product_id,
      'on_order',
      COALESCE((SELECT max(sort_order) + 1 FROM price_list_items WHERE price_list_id = v_supplier_list.price_list_id), 0)
        + item.sort_order,
      v_supplier_list.id
    FROM reseller_supplier_list_items item
    WHERE item.supplier_list_id = v_supplier_list.id
    ON CONFLICT (price_list_id, product_id) DO UPDATE
      SET availability = 'on_order',
          supplier_list_id = EXCLUDED.supplier_list_id,
          updated_at = now();
  ELSE
    DELETE FROM price_list_items
    WHERE supplier_list_id = v_supplier_list.id;
  END IF;

  RETURN v_supplier_list;
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

  DELETE FROM price_list_items
  WHERE price_list_id = p_list_id AND user_id = v_uid;

  INSERT INTO price_list_items (
    user_id, price_list_id, product_id, pricing_mode,
    discount_percent, fixed_price, availability, sort_order, supplier_list_id
  )
  SELECT
    v_uid,
    p_list_id,
    (item->>'productId')::uuid,
    COALESCE(item->>'pricingMode', 'default'),
    CASE WHEN item->>'pricingMode' = 'discount' THEN (item->>'discountPercent')::numeric ELSE NULL END,
    CASE WHEN item->>'pricingMode' = 'fixed' THEN (item->>'fixedPrice')::numeric ELSE NULL END,
    COALESCE(item->>'availability', 'in_stock'),
    COALESCE((item->>'sortOrder')::integer, 0),
    CASE
      WHEN COALESCE(item->>'supplierListId', '') = '' THEN NULL
      ELSE (item->>'supplierListId')::uuid
    END
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) item;

  IF EXISTS (
    SELECT 1
    FROM price_list_items pli
    LEFT JOIN reseller_supplier_lists rsl
      ON rsl.id = pli.supplier_list_id
      AND rsl.user_id = v_uid
      AND rsl.price_list_id = p_list_id
      AND rsl.enabled
    LEFT JOIN reseller_supplier_list_items rsli
      ON rsli.supplier_list_id = rsl.id
      AND rsli.product_id = pli.product_id
    WHERE pli.price_list_id = p_list_id
      AND pli.supplier_list_id IS NOT NULL
      AND (rsl.id IS NULL OR rsli.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'La lista contiene una agrupación por proveedor inválida';
  END IF;

  RETURN v_list;
END;
$$;

CREATE OR REPLACE FUNCTION get_reseller_catalog_status(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE(bool_or(
      cc.enabled
      AND pl.public_enabled
      AND pl.access_code_hash IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM price_list_items pli
        JOIN products p ON p.id = pli.product_id AND p.user_id = pl.user_id
        WHERE pli.price_list_id = pl.id
          AND (pli.availability = 'on_order' OR p.stock > 0)
      )
    ), false)
  )
  FROM catalog_config cc
  LEFT JOIN price_lists pl ON pl.user_id = cc.user_id AND pl.kind = 'reseller'
  WHERE cc.slug = btrim(p_slug);
$$;

CREATE OR REPLACE FUNCTION unlock_reseller_catalog(
  p_slug text,
  p_access_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_list price_lists;
  v_products jsonb;
BEGIN
  SELECT pl.* INTO v_list
  FROM catalog_config cc
  JOIN price_lists pl ON pl.user_id = cc.user_id AND pl.kind = 'reseller'
  WHERE cc.slug = btrim(p_slug)
    AND cc.enabled
    AND pl.public_enabled
    AND pl.access_code_hash = encode(
      extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'),
      'hex'
    );

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'Codigo de acceso invalido';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'categoryId', p.category_id,
      'category', p.category,
      'salePrice', CASE
        WHEN pli.pricing_mode = 'fixed' THEN round(GREATEST(pli.fixed_price, 0))
        WHEN pli.pricing_mode = 'discount' THEN round(GREATEST(p.sale_price, 0) * (1 - pli.discount_percent / 100))
        ELSE round(GREATEST(p.sale_price, 0) * (1 - v_list.default_discount_percent / 100))
      END,
      'stock', p.stock,
      'imageUrl', p.image_url,
      'images', COALESCE(to_jsonb(p.images), '[]'::jsonb),
      'description', p.description,
      'availability', pli.availability
    ) ORDER BY pli.sort_order, p.name
  ), '[]'::jsonb) INTO v_products
  FROM price_list_items pli
  JOIN products p ON p.id = pli.product_id AND p.user_id = v_list.user_id
  WHERE pli.price_list_id = v_list.id
    AND (pli.availability = 'on_order' OR p.stock > 0);

  RETURN jsonb_build_object(
    'enabled', true,
    'priceListId', v_list.id,
    'minimumRule', v_list.minimum_rule,
    'minimumOrderAmount', v_list.minimum_order_amount,
    'minimumOrderQuantity', v_list.minimum_order_quantity,
    'products', v_products
  );
END;
$$;

REVOKE ALL ON FUNCTION save_reseller_supplier_list(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION toggle_reseller_supplier_list(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_reseller_supplier_list(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION toggle_reseller_supplier_list(uuid, boolean) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON reseller_supplier_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reseller_supplier_list_items TO authenticated;

COMMIT;

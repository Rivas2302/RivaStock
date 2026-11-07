BEGIN;

CREATE OR REPLACE FUNCTION public.save_reseller_supplier_list(
  p_list_id uuid,
  p_supplier_id uuid,
  p_product_ids uuid[]
)
RETURNS public.reseller_supplier_lists
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
  IF cardinality(v_product_ids) > 3000 THEN
    RAISE EXCEPTION 'La lista no puede superar 3000 productos';
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

CREATE OR REPLACE FUNCTION public.save_reseller_supplier_list_pricing(
  p_supplier_list_id uuid,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_item jsonb;
  v_product_id uuid;
  v_cost numeric;
  v_margin numeric;
  v_rounding integer;
  v_price numeric;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para editar los precios de la lista';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM reseller_supplier_lists supplier_list
    WHERE supplier_list.id = p_supplier_list_id AND supplier_list.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Lista del proveedor no encontrada';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_items) > 3000 THEN
    RAISE EXCEPTION 'La lista no puede superar 3000 precios';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF COALESCE(v_item->>'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Producto inválido en la lista';
    END IF;
    v_product_id := (v_item->>'productId')::uuid;
    v_cost := (v_item->>'supplierCost')::numeric;
    v_margin := (v_item->>'marginPercent')::numeric;
    v_rounding := COALESCE((v_item->>'roundingStep')::integer, 0);
    IF v_cost <= 0 OR v_margin < 0 OR v_rounding NOT IN (0, 100, 500)
       OR NOT EXISTS (
         SELECT 1 FROM reseller_supplier_list_items item
         WHERE item.supplier_list_id = p_supplier_list_id
           AND item.user_id = v_uid AND item.product_id = v_product_id
       ) THEN
      RAISE EXCEPTION 'Revisá costo, margen y pertenencia de los productos';
    END IF;
    v_price := v_cost * (1 + v_margin / 100);
    v_price := CASE WHEN v_rounding = 0 THEN round(v_price, 2) ELSE round(v_price / v_rounding) * v_rounding END;

    INSERT INTO reseller_supplier_list_pricing(
      user_id, supplier_list_id, product_id, supplier_cost,
      margin_percent, rounding_step, suggested_reseller_price, updated_at
    ) VALUES (
      v_uid, p_supplier_list_id, v_product_id, v_cost,
      v_margin, v_rounding, v_price, now()
    ) ON CONFLICT (supplier_list_id, product_id) DO UPDATE
      SET supplier_cost = EXCLUDED.supplier_cost,
          margin_percent = EXCLUDED.margin_percent,
          rounding_step = EXCLUDED.rounding_step,
          suggested_reseller_price = EXCLUDED.suggested_reseller_price,
          updated_at = now();

    UPDATE price_list_items
    SET pricing_mode = 'fixed', discount_percent = NULL,
        fixed_price = v_price, updated_at = now()
    WHERE supplier_list_id = p_supplier_list_id
      AND product_id = v_product_id
      AND user_id = v_uid;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

COMMIT;

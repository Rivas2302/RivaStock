BEGIN;

ALTER TABLE public.reseller_supplier_order_rounds
  ADD COLUMN IF NOT EXISTS minimum_order_quantity integer NOT NULL DEFAULT 0
    CHECK (minimum_order_quantity >= 0),
  ADD COLUMN IF NOT EXISTS supplier_minimum_order_amount numeric NOT NULL DEFAULT 0
    CHECK (supplier_minimum_order_amount >= 0);

CREATE OR REPLACE FUNCTION public.create_reseller_supplier_order_round(
  p_supplier_list_id uuid,
  p_closes_at timestamptz,
  p_minimum_order_amount numeric,
  p_minimum_order_quantity integer,
  p_supplier_minimum_order_amount numeric,
  p_audience_name text,
  p_audience_code text
)
RETURNS public.reseller_supplier_order_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_round public.reseller_supplier_order_rounds;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar rondas de pedido';
  END IF;
  IF p_closes_at IS NULL OR p_closes_at <= now()
     OR COALESCE(p_minimum_order_amount, 0) < 0
     OR COALESCE(p_minimum_order_quantity, 0) < 0
     OR COALESCE(p_supplier_minimum_order_amount, 0) < 0
     OR length(btrim(COALESCE(p_audience_name, ''))) NOT BETWEEN 1 AND 80
     OR (btrim(COALESCE(p_audience_code, '')) = '' AND lower(btrim(COALESCE(p_audience_name, ''))) <> 'todos los revendedores')
     OR (btrim(COALESCE(p_audience_code, '')) <> '' AND length(btrim(p_audience_code)) < 6) THEN
    RAISE EXCEPTION 'Revisá la fecha de cierre, los mínimos y el grupo de acceso';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM reseller_supplier_lists supplier_list
    WHERE supplier_list.id = p_supplier_list_id
      AND supplier_list.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Lista del proveedor no encontrada';
  END IF;

  INSERT INTO reseller_supplier_order_rounds(
    user_id, supplier_list_id, audience_name, audience_code_hash, closes_at,
    minimum_order_amount, minimum_order_quantity, supplier_minimum_order_amount
  )
  VALUES (
    v_uid, p_supplier_list_id, btrim(p_audience_name),
    CASE WHEN btrim(COALESCE(p_audience_code, '')) = '' THEN NULL
      ELSE encode(extensions.digest(lower(btrim(p_audience_code)), 'sha256'), 'hex') END,
    p_closes_at, COALESCE(p_minimum_order_amount, 0),
    COALESCE(p_minimum_order_quantity, 0), COALESCE(p_supplier_minimum_order_amount, 0)
  )
  RETURNING * INTO v_round;
  RETURN v_round;
END;
$$;

REVOKE ALL ON FUNCTION public.create_reseller_supplier_order_round(uuid, timestamptz, numeric, integer, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_reseller_supplier_order_round(uuid, timestamptz, numeric, integer, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_reseller_supplier_rounds(
  p_slug text,
  p_access_code text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', round.id,
    'supplierListId', supplier_list.id,
    'supplierName', supplier.name,
    'audienceName', round.audience_name,
    'closesAt', round.closes_at,
    'minimumOrderAmount', round.minimum_order_amount,
    'minimumOrderQuantity', round.minimum_order_quantity,
    'supplierMinimumOrderAmount', round.supplier_minimum_order_amount,
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', product.id,
        'name', product.name,
        'categoryId', product.category_id,
        'category', product.category,
        'salePrice', CASE
          WHEN price_item.pricing_mode = 'fixed' THEN round(GREATEST(price_item.fixed_price, 0))
          WHEN price_item.pricing_mode = 'discount' THEN round(GREATEST(product.sale_price, 0) * (1 - price_item.discount_percent / 100))
          ELSE round(GREATEST(product.sale_price, 0) * (1 - price_list.default_discount_percent / 100))
        END,
        'imageUrl', product.image_url,
        'images', COALESCE(to_jsonb(product.images), '[]'::jsonb)
      ) ORDER BY list_item.sort_order, product.name)
      FROM reseller_supplier_list_items list_item
      JOIN products product ON product.id = list_item.product_id AND product.user_id = round.user_id
      JOIN price_list_items price_item ON price_item.product_id = product.id
        AND price_item.price_list_id = supplier_list.price_list_id
        AND price_item.supplier_list_id = supplier_list.id
      WHERE list_item.supplier_list_id = supplier_list.id
    ), '[]'::jsonb)
  ) ORDER BY round.closes_at), '[]'::jsonb)
  FROM catalog_config catalog
  JOIN price_lists price_list ON price_list.user_id = catalog.user_id AND price_list.kind = 'reseller'
  JOIN reseller_supplier_lists supplier_list ON supplier_list.price_list_id = price_list.id AND supplier_list.user_id = catalog.user_id
  JOIN suppliers supplier ON supplier.id = supplier_list.supplier_id AND supplier.user_id = catalog.user_id
  JOIN reseller_supplier_order_rounds round ON round.supplier_list_id = supplier_list.id AND round.user_id = catalog.user_id
  WHERE catalog.slug = btrim(p_slug)
    AND catalog.enabled
    AND catalog.allow_orders
    AND NULLIF(btrim(catalog.whatsapp_number), '') IS NOT NULL
    AND price_list.public_enabled
    AND (
      (round.audience_code_hash IS NULL
        AND price_list.access_code_hash = encode(extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'), 'hex'))
      OR round.audience_code_hash = encode(extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'), 'hex')
    )
    AND supplier_list.enabled
    AND round.status = 'open'
    AND round.closes_at > now();
$$;

CREATE OR REPLACE FUNCTION public.create_public_reseller_supplier_round_order(
  p_slug text,
  p_access_code text,
  p_round_id uuid,
  p_customer jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_round public.reseller_supplier_order_rounds;
  v_supplier_list public.reseller_supplier_lists;
  v_catalog_owner uuid;
  v_order jsonb;
  v_order_row public.orders;
  v_snapshot jsonb;
  v_supplier_total numeric := 0;
  v_order_quantity integer := 0;
BEGIN
  SELECT catalog.user_id INTO v_catalog_owner
  FROM catalog_config catalog
  WHERE catalog.slug = btrim(p_slug)
    AND catalog.enabled
    AND catalog.allow_orders
    AND NULLIF(btrim(catalog.whatsapp_number), '') IS NOT NULL;
  IF v_catalog_owner IS NULL THEN RAISE EXCEPTION 'El catálogo no está disponible para pedidos'; END IF;

  SELECT * INTO v_round FROM reseller_supplier_order_rounds
  WHERE id = p_round_id AND user_id = v_catalog_owner FOR UPDATE;
  IF v_round.id IS NULL OR v_round.status <> 'open' OR v_round.closes_at <= now() THEN
    RAISE EXCEPTION 'Esta ronda ya cerró';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM price_lists price_list
    WHERE price_list.user_id = v_catalog_owner
      AND price_list.kind = 'reseller'
      AND price_list.public_enabled
      AND (
        (v_round.audience_code_hash IS NULL
          AND price_list.access_code_hash = encode(extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'), 'hex'))
        OR v_round.audience_code_hash = encode(extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'), 'hex')
      )
  ) THEN
    RAISE EXCEPTION 'El código no tiene acceso a esta ronda';
  END IF;
  SELECT * INTO v_supplier_list FROM reseller_supplier_lists
  WHERE id = v_round.supplier_list_id AND user_id = v_catalog_owner AND enabled;
  IF v_supplier_list.id IS NULL THEN RAISE EXCEPTION 'La lista del proveedor no está disponible'; END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'El pedido no contiene productos válidos';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) input_item
    LEFT JOIN reseller_supplier_list_items supplier_item
      ON supplier_item.supplier_list_id = v_supplier_list.id
      AND supplier_item.product_id::text = input_item->>'productId'
    LEFT JOIN products product ON product.id = supplier_item.product_id AND product.user_id = v_catalog_owner
    WHERE supplier_item.id IS NULL OR COALESCE(product.catalog_cost, product.purchase_price, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'El pedido contiene productos sin costo válido para esta ronda';
  END IF;

  v_order := create_public_catalog_order(p_slug, 'reseller', p_access_code, p_customer, p_items);
  SELECT * INTO v_order_row FROM orders
  WHERE id = (v_order->>'id')::uuid AND user_id = v_catalog_owner;
  IF v_order_row.id IS NULL THEN RAISE EXCEPTION 'No se pudo crear el pedido'; END IF;
  IF COALESCE(v_order_row.total, 0) < v_round.minimum_order_amount THEN
    RAISE EXCEPTION 'El pedido no alcanza el mínimo por revendedor de esta tanda';
  END IF;
  SELECT COALESCE(sum((item->>'quantity')::integer), 0)::integer
    INTO v_order_quantity
  FROM jsonb_array_elements(COALESCE(v_order_row.items, '[]'::jsonb)) item;
  IF v_order_quantity < v_round.minimum_order_quantity THEN
    RAISE EXCEPTION 'El pedido no alcanza el mínimo de unidades por revendedor de esta tanda';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', item->>'productId',
    'productName', item->>'productName',
    'quantity', (item->>'quantity')::integer,
    'supplierUnitCost', COALESCE(product.catalog_cost, product.purchase_price),
    'resellerUnitPrice', (item->>'price')::numeric
  )), '[]'::jsonb),
  COALESCE(sum(COALESCE(product.catalog_cost, product.purchase_price) * (item->>'quantity')::integer), 0)
  INTO v_snapshot, v_supplier_total
  FROM jsonb_array_elements(v_order_row.items) item
  JOIN products product ON product.id::text = item->>'productId' AND product.user_id = v_catalog_owner;

  INSERT INTO reseller_supplier_round_orders(
    user_id, round_id, order_id, reseller_name, reseller_phone, items_snapshot,
    supplier_total, reseller_total, profit
  ) VALUES (
    v_catalog_owner, v_round.id, v_order_row.id,
    btrim(COALESCE(p_customer->>'name', '')),
    btrim(COALESCE(p_customer->>'phone', '')),
    v_snapshot,
    v_supplier_total,
    v_order_row.total,
    v_order_row.total - v_supplier_total
  );

  RETURN jsonb_build_object('id', v_order_row.id, 'total', v_order_row.total, 'closesAt', v_round.closes_at);
END;
$$;

COMMIT;

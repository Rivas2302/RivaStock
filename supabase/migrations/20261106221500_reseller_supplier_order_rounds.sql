-- Supplier order rounds reuse reseller supplier lists and the existing public
-- reseller checkout. Order and cost snapshots keep totals stable after edits.

BEGIN;

CREATE TABLE reseller_supplier_order_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  supplier_list_id uuid NOT NULL REFERENCES reseller_supplier_lists(id) ON DELETE CASCADE,
  audience_name text NOT NULL DEFAULT 'Todos los revendedores' CHECK (length(btrim(audience_name)) BETWEEN 1 AND 80),
  audience_code_hash text,
  closes_at timestamptz NOT NULL,
  minimum_order_amount numeric NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'open' OR closes_at > created_at)
);

CREATE INDEX reseller_supplier_rounds_owner_status_idx
  ON reseller_supplier_order_rounds(user_id, status, closes_at DESC);
CREATE INDEX reseller_supplier_rounds_list_idx
  ON reseller_supplier_order_rounds(supplier_list_id, closes_at DESC);

CREATE TABLE reseller_supplier_list_pricing (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  supplier_list_id uuid NOT NULL REFERENCES reseller_supplier_lists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_cost numeric NOT NULL CHECK (supplier_cost > 0),
  margin_percent numeric NOT NULL CHECK (margin_percent >= 0),
  rounding_step integer NOT NULL DEFAULT 0 CHECK (rounding_step IN (0, 100, 500)),
  suggested_reseller_price numeric NOT NULL CHECK (suggested_reseller_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_list_id, product_id)
);

CREATE INDEX reseller_supplier_list_pricing_owner_idx
  ON reseller_supplier_list_pricing(user_id, supplier_list_id);
ALTER TABLE reseller_supplier_list_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY reseller_supplier_list_pricing_select_owner
  ON reseller_supplier_list_pricing FOR SELECT TO authenticated
  USING (user_id = (SELECT get_owner_uid((SELECT auth.uid()))));
GRANT SELECT ON reseller_supplier_list_pricing TO authenticated;

CREATE OR REPLACE FUNCTION sync_reseller_supplier_list_item_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price numeric;
BEGIN
  IF NEW.supplier_list_id IS NULL THEN RETURN NEW; END IF;
  SELECT pricing.suggested_reseller_price INTO v_price
  FROM reseller_supplier_list_pricing pricing
  WHERE pricing.user_id = NEW.user_id
    AND pricing.supplier_list_id = NEW.supplier_list_id
    AND pricing.product_id = NEW.product_id;
  IF v_price IS NOT NULL THEN
    NEW.pricing_mode := 'fixed';
    NEW.discount_percent := NULL;
    NEW.fixed_price := v_price;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reseller_supplier_list_item_fixed_price
  BEFORE INSERT OR UPDATE OF supplier_list_id, product_id, pricing_mode, discount_percent, fixed_price
  ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION sync_reseller_supplier_list_item_price();

REVOKE ALL ON FUNCTION sync_reseller_supplier_list_item_price() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION save_reseller_supplier_list_pricing(
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
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'La lista no puede superar 500 precios';
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

CREATE OR REPLACE FUNCTION save_reseller_supplier_list_with_pricing(
  p_list_id uuid,
  p_supplier_id uuid,
  p_product_ids uuid[],
  p_prices jsonb
)
RETURNS reseller_supplier_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list reseller_supplier_lists;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar listas por proveedor';
  END IF;
  v_list := save_reseller_supplier_list(p_list_id, p_supplier_id, p_product_ids);
  PERFORM save_reseller_supplier_list_pricing(v_list.id, COALESCE(p_prices, '[]'::jsonb));
  RETURN v_list;
END;
$$;

CREATE TABLE reseller_supplier_round_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES reseller_supplier_order_rounds(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  reseller_name text NOT NULL,
  reseller_phone text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'payment_coordinated', 'paid', 'sent_to_supplier', 'ready')),
  items_snapshot jsonb NOT NULL CHECK (jsonb_typeof(items_snapshot) = 'array'),
  supplier_total numeric NOT NULL CHECK (supplier_total >= 0),
  reseller_total numeric NOT NULL CHECK (reseller_total >= 0),
  profit numeric NOT NULL,
  paid_at timestamptz,
  payment_coordinated_at timestamptz,
  supplier_sent_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reseller_supplier_round_orders_owner_round_idx
  ON reseller_supplier_round_orders(user_id, round_id, created_at DESC);
CREATE INDEX reseller_supplier_round_orders_unpaid_idx
  ON reseller_supplier_round_orders(round_id, created_at)
  WHERE paid_at IS NULL;

ALTER TABLE reseller_supplier_order_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE reseller_supplier_round_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY reseller_supplier_order_rounds_select_owner
  ON reseller_supplier_order_rounds FOR SELECT TO authenticated
  USING (user_id = (SELECT get_owner_uid((SELECT auth.uid()))));
CREATE POLICY reseller_supplier_round_orders_select_owner
  ON reseller_supplier_round_orders FOR SELECT TO authenticated
  USING (user_id = (SELECT get_owner_uid((SELECT auth.uid()))));

GRANT SELECT ON reseller_supplier_order_rounds TO authenticated;
GRANT SELECT ON reseller_supplier_round_orders TO authenticated;

CREATE OR REPLACE FUNCTION create_reseller_supplier_order_round(
  p_supplier_list_id uuid,
  p_closes_at timestamptz,
  p_minimum_order_amount numeric DEFAULT 0,
  p_audience_name text DEFAULT 'Todos los revendedores',
  p_audience_code text DEFAULT ''
)
RETURNS reseller_supplier_order_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_round reseller_supplier_order_rounds;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar rondas de pedido';
  END IF;
  IF p_closes_at IS NULL OR p_closes_at <= now()
     OR COALESCE(p_minimum_order_amount, 0) < 0
     OR length(btrim(COALESCE(p_audience_name, ''))) NOT BETWEEN 1 AND 80
     OR (btrim(COALESCE(p_audience_code, '')) = '' AND lower(btrim(COALESCE(p_audience_name, ''))) <> 'todos los revendedores')
     OR (btrim(COALESCE(p_audience_code, '')) <> '' AND length(btrim(p_audience_code)) < 6) THEN
    RAISE EXCEPTION 'Revisá la fecha de cierre y el pedido mínimo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM reseller_supplier_lists supplier_list
    WHERE supplier_list.id = p_supplier_list_id
      AND supplier_list.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Lista del proveedor no encontrada';
  END IF;

  INSERT INTO reseller_supplier_order_rounds(user_id, supplier_list_id, audience_name, audience_code_hash, closes_at, minimum_order_amount)
  VALUES (
    v_uid, p_supplier_list_id, btrim(p_audience_name),
    CASE WHEN btrim(COALESCE(p_audience_code, '')) = '' THEN NULL
      ELSE encode(extensions.digest(lower(btrim(p_audience_code)), 'sha256'), 'hex') END,
    p_closes_at, COALESCE(p_minimum_order_amount, 0)
  )
  RETURNING * INTO v_round;
  RETURN v_round;
END;
$$;

CREATE OR REPLACE FUNCTION set_reseller_supplier_order_round_status(
  p_round_id uuid,
  p_status text
)
RETURNS reseller_supplier_order_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_round reseller_supplier_order_rounds;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar rondas de pedido';
  END IF;
  IF p_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Estado de ronda inválido';
  END IF;
  SELECT * INTO v_round FROM reseller_supplier_order_rounds
  WHERE id = p_round_id AND user_id = v_uid FOR UPDATE;
  IF v_round.id IS NULL THEN RAISE EXCEPTION 'Ronda no encontrada'; END IF;
  IF p_status = 'open' AND (
    v_round.closes_at <= now()
    OR NOT EXISTS (
      SELECT 1 FROM catalog_config catalog
      WHERE catalog.user_id = v_uid
        AND NULLIF(btrim(catalog.whatsapp_number), '') IS NOT NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM reseller_supplier_lists supplier_list
      JOIN reseller_supplier_list_items list_item ON list_item.supplier_list_id = supplier_list.id
      WHERE supplier_list.id = v_round.supplier_list_id
        AND supplier_list.user_id = v_uid
        AND supplier_list.enabled
    )
  ) THEN
    RAISE EXCEPTION 'La lista debe estar habilitada, tener productos y cerrar en el futuro';
  END IF;
  UPDATE reseller_supplier_order_rounds
  SET status = p_status, updated_at = now()
  WHERE id = p_round_id
  RETURNING * INTO v_round;
  RETURN v_round;
END;
$$;

CREATE OR REPLACE FUNCTION set_reseller_supplier_round_order_status(
  p_round_order_id uuid,
  p_status text
)
RETURNS reseller_supplier_round_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_order reseller_supplier_round_orders;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar pedidos de revendedores';
  END IF;
  IF p_status NOT IN ('received', 'payment_coordinated', 'paid', 'sent_to_supplier', 'ready') THEN
    RAISE EXCEPTION 'Estado de pedido inválido';
  END IF;
  UPDATE reseller_supplier_round_orders
  SET status = p_status,
      paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
      payment_coordinated_at = CASE WHEN p_status = 'payment_coordinated' THEN COALESCE(payment_coordinated_at, now()) ELSE payment_coordinated_at END,
      supplier_sent_at = CASE WHEN p_status = 'sent_to_supplier' THEN COALESCE(supplier_sent_at, now()) ELSE supplier_sent_at END,
      ready_at = CASE WHEN p_status = 'ready' THEN COALESCE(ready_at, now()) ELSE ready_at END,
      updated_at = now()
  WHERE id = p_round_order_id AND user_id = v_uid
  RETURNING * INTO v_order;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Pedido de ronda no encontrado'; END IF;
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION get_public_reseller_supplier_rounds(
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

CREATE OR REPLACE FUNCTION create_public_reseller_supplier_round_order(
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
  v_round reseller_supplier_order_rounds;
  v_supplier_list reseller_supplier_lists;
  v_catalog_owner uuid;
  v_order jsonb;
  v_order_row orders;
  v_snapshot jsonb;
  v_supplier_total numeric := 0;
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
  IF (v_order->>'total')::numeric < v_round.minimum_order_amount THEN
    RAISE EXCEPTION 'El pedido no alcanza el mínimo de esta ronda';
  END IF;
  SELECT * INTO v_order_row FROM orders
  WHERE id = (v_order->>'id')::uuid AND user_id = v_catalog_owner;
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

REVOKE ALL ON FUNCTION create_reseller_supplier_order_round(uuid, timestamptz, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_reseller_supplier_order_round_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_reseller_supplier_round_order_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_reseller_supplier_list_pricing(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_reseller_supplier_list_with_pricing(uuid, uuid, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_reseller_supplier_rounds(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_public_reseller_supplier_round_order(text, text, uuid, jsonb, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_reseller_supplier_order_round(uuid, timestamptz, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_reseller_supplier_order_round_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_reseller_supplier_round_order_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION save_reseller_supplier_list_pricing(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION save_reseller_supplier_list_with_pricing(uuid, uuid, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION get_public_reseller_supplier_rounds(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_public_reseller_supplier_round_order(text, text, uuid, jsonb, jsonb) TO anon, authenticated;

COMMIT;

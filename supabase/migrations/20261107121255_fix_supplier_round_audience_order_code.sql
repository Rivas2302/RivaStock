-- Allow an audience code to place an order only through its specific open
-- supplier round. This function writes the order directly after validating
-- the requested round and its own product list; it never forwards an
-- audience code to the general reseller catalog RPC.

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
  v_config catalog_config;
  v_round reseller_supplier_order_rounds;
  v_supplier_list reseller_supplier_lists;
  v_list price_lists;
  v_product products;
  v_price_item price_list_items;
  v_catalog_owner uuid;
  v_order_id uuid;
  v_input jsonb;
  v_product_id uuid;
  v_seen_product_ids uuid[] := ARRAY[]::uuid[];
  v_quantity integer;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_total numeric := 0;
  v_supplier_total numeric := 0;
  v_total_quantity integer := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_snapshot jsonb := '[]'::jsonb;
  v_name text := btrim(COALESCE(p_customer->>'name', ''));
  v_phone text := btrim(COALESCE(p_customer->>'phone', ''));
  v_email text := btrim(COALESCE(p_customer->>'email', ''));
  v_address text := btrim(COALESCE(p_customer->>'address', ''));
  v_message text := btrim(COALESCE(p_customer->>'message', ''));
  v_code_hash text := encode(extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'), 'hex');
  v_round_code_matches boolean := false;
  v_list_code_matches boolean := false;
BEGIN
  SELECT * INTO v_config
  FROM catalog_config
  WHERE slug = btrim(p_slug) AND enabled AND allow_orders
    AND NULLIF(btrim(whatsapp_number), '') IS NOT NULL;
  IF v_config.id IS NULL THEN
    RAISE EXCEPTION 'El catálogo no está disponible para pedidos';
  END IF;
  v_catalog_owner := v_config.user_id;

  SELECT * INTO v_round
  FROM reseller_supplier_order_rounds
  WHERE id = p_round_id AND user_id = v_catalog_owner
  FOR UPDATE;
  IF v_round.id IS NULL OR v_round.status <> 'open' OR v_round.closes_at <= now() THEN
    RAISE EXCEPTION 'Esta ronda ya cerró';
  END IF;

  SELECT * INTO v_supplier_list
  FROM reseller_supplier_lists
  WHERE id = v_round.supplier_list_id
    AND user_id = v_catalog_owner
    AND enabled;
  IF v_supplier_list.id IS NULL THEN
    RAISE EXCEPTION 'La lista del proveedor no está disponible';
  END IF;

  SELECT * INTO v_list
  FROM price_lists
  WHERE id = v_supplier_list.price_list_id
    AND user_id = v_catalog_owner
    AND kind = 'reseller'
    AND public_enabled;
  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'La lista de revendedores no está disponible';
  END IF;

  v_list_code_matches := v_list.access_code_hash = v_code_hash;
  v_round_code_matches := v_round.audience_code_hash IS NOT NULL
    AND v_round.audience_code_hash = v_code_hash;
  IF NOT v_list_code_matches AND NOT v_round_code_matches THEN
    RAISE EXCEPTION 'El código no tiene acceso a esta ronda';
  END IF;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'El pedido no contiene productos válidos';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_phone) < 5 OR char_length(v_address) < 3 THEN
    RAISE EXCEPTION 'Completá nombre, WhatsApp y dirección';
  END IF;
  IF char_length(v_name) > 120 OR char_length(v_phone) > 40 OR char_length(v_email) > 160
     OR char_length(v_address) > 300 OR char_length(v_message) > 1000 THEN
    RAISE EXCEPTION 'Los datos del cliente son demasiado largos';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Email inválido';
  END IF;
  IF EXISTS (
    SELECT 1 FROM orders
    WHERE user_id = v_catalog_owner
      AND customer_phone = v_phone
      AND created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'Esperá unos segundos antes de enviar otro pedido';
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE(v_input->>'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(v_input->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Producto o cantidad inválida';
    END IF;
    v_product_id := (v_input->>'productId')::uuid;
    v_quantity := (v_input->>'quantity')::integer;
    IF v_quantity < 1 OR v_quantity > 9999 OR v_product_id = ANY(v_seen_product_ids) THEN
      RAISE EXCEPTION 'Producto o cantidad inválida';
    END IF;
    v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

    SELECT product.*
    INTO v_product
    FROM reseller_supplier_list_items supplier_item
    JOIN products product
      ON product.id = supplier_item.product_id
      AND product.user_id = v_catalog_owner
    WHERE supplier_item.supplier_list_id = v_supplier_list.id
      AND supplier_item.product_id = v_product_id;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'El producto no pertenece a esta ronda';
    END IF;

    SELECT * INTO v_price_item
    FROM price_list_items
    WHERE product_id = v_product.id
      AND price_list_id = v_list.id
      AND supplier_list_id = v_supplier_list.id;
    IF v_price_item.id IS NULL THEN
      RAISE EXCEPTION 'El producto no pertenece a esta ronda';
    END IF;

    v_unit_cost := COALESCE(v_product.catalog_cost, v_product.purchase_price, 0);
    IF v_unit_cost <= 0 THEN
      RAISE EXCEPTION 'El producto no tiene un costo válido para esta ronda';
    END IF;
    IF v_price_item.availability = 'in_stock' AND v_quantity > v_product.stock THEN
      RAISE EXCEPTION 'Stock insuficiente para %', v_product.name;
    END IF;
    v_unit_price := CASE
      WHEN v_price_item.pricing_mode = 'fixed' THEN round(GREATEST(v_price_item.fixed_price, 0))
      WHEN v_price_item.pricing_mode = 'discount' THEN round(GREATEST(v_product.sale_price, 0) * (1 - v_price_item.discount_percent / 100))
      ELSE round(GREATEST(v_product.sale_price, 0) * (1 - v_list.default_discount_percent / 100))
    END;

    v_total := v_total + v_unit_price * v_quantity;
    v_supplier_total := v_supplier_total + v_unit_cost * v_quantity;
    v_total_quantity := v_total_quantity + v_quantity;
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'price', v_unit_price,
      'availability', v_price_item.availability
    ));
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'supplierUnitCost', v_unit_cost,
      'resellerUnitPrice', v_unit_price
    ));
  END LOOP;

  IF v_list.minimum_rule IN ('amount', 'both') AND v_total < v_list.minimum_order_amount THEN
    RAISE EXCEPTION 'El pedido no alcanza el monto mínimo';
  END IF;
  IF v_list.minimum_rule IN ('quantity', 'both') AND v_total_quantity < v_list.minimum_order_quantity THEN
    RAISE EXCEPTION 'El pedido no alcanza la cantidad mínima';
  END IF;
  IF v_total < v_round.minimum_order_amount THEN
    RAISE EXCEPTION 'El pedido no alcanza el mínimo de esta ronda';
  END IF;

  INSERT INTO orders (
    user_id, date, customer_name, customer_phone, customer_email,
    customer_address, customer_message, items, total, status, is_read,
    channel, price_list_id
  ) VALUES (
    v_catalog_owner, CURRENT_DATE, v_name, v_phone, v_email,
    v_address, NULLIF(v_message, ''), v_order_items, v_total, 'Nuevo', false,
    'reseller', v_list.id
  ) RETURNING id INTO v_order_id;

  INSERT INTO reseller_supplier_round_orders (
    user_id, round_id, order_id, reseller_name, reseller_phone, items_snapshot,
    supplier_total, reseller_total, profit
  ) VALUES (
    v_catalog_owner, v_round.id, v_order_id, v_name, v_phone, v_snapshot,
    v_supplier_total, v_total, v_total - v_supplier_total
  );

  RETURN jsonb_build_object('id', v_order_id, 'total', v_total, 'closesAt', v_round.closes_at);
END;
$$;

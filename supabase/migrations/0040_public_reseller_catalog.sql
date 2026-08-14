-- Public reseller catalog configuration and server-authoritative ordering.

BEGIN;

ALTER TABLE price_lists
  ADD COLUMN public_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN access_code_hash text,
  ADD COLUMN minimum_rule text NOT NULL DEFAULT 'none'
    CHECK (minimum_rule IN ('none', 'amount', 'quantity', 'both')),
  ADD COLUMN minimum_order_amount numeric NOT NULL DEFAULT 0
    CHECK (minimum_order_amount >= 0),
  ADD COLUMN minimum_order_quantity integer NOT NULL DEFAULT 0
    CHECK (minimum_order_quantity >= 0);

ALTER TABLE orders
  ADD COLUMN channel text NOT NULL DEFAULT 'retail'
    CHECK (channel IN ('retail', 'reseller')),
  ADD COLUMN price_list_id uuid REFERENCES price_lists(id) ON DELETE SET NULL;

CREATE INDEX orders_price_list_id_idx ON orders(price_list_id)
  WHERE price_list_id IS NOT NULL;

CREATE OR REPLACE FUNCTION configure_reseller_price_list(
  p_list_id uuid,
  p_public_enabled boolean,
  p_access_code text,
  p_minimum_rule text,
  p_minimum_order_amount numeric,
  p_minimum_order_quantity integer
)
RETURNS price_lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := get_owner_uid(auth.uid());
  v_list price_lists;
  v_code text := lower(btrim(COALESCE(p_access_code, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar listas de precios';
  END IF;
  IF p_minimum_rule IS NULL OR p_minimum_rule NOT IN ('none', 'amount', 'quantity', 'both') THEN
    RAISE EXCEPTION 'Regla comercial invalida';
  END IF;
  IF COALESCE(p_minimum_order_amount, 0) < 0 OR COALESCE(p_minimum_order_quantity, 0) < 0 THEN
    RAISE EXCEPTION 'Los minimos comerciales no pueden ser negativos';
  END IF;
  IF v_code <> '' AND char_length(v_code) < 6 THEN
    RAISE EXCEPTION 'El codigo de acceso debe tener al menos 6 caracteres';
  END IF;

  SELECT * INTO v_list
  FROM price_lists
  WHERE id = p_list_id AND user_id = v_uid AND kind = 'reseller';
  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'Lista de revendedores no encontrada';
  END IF;
  IF p_public_enabled AND v_code = '' AND v_list.access_code_hash IS NULL THEN
    RAISE EXCEPTION 'Configura un codigo de acceso antes de publicar la lista';
  END IF;

  UPDATE price_lists
  SET public_enabled = p_public_enabled,
      access_code_hash = CASE
        WHEN v_code <> '' THEN encode(extensions.digest(v_code, 'sha256'), 'hex')
        ELSE access_code_hash
      END,
      minimum_rule = p_minimum_rule,
      minimum_order_amount = CASE
        WHEN p_minimum_rule IN ('amount', 'both') THEN COALESCE(p_minimum_order_amount, 0)
        ELSE 0
      END,
      minimum_order_quantity = CASE
        WHEN p_minimum_rule IN ('quantity', 'both') THEN COALESCE(p_minimum_order_quantity, 0)
        ELSE 0
      END,
      updated_at = now()
  WHERE id = p_list_id
  RETURNING * INTO v_list;

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
      AND EXISTS (SELECT 1 FROM price_list_items pli WHERE pli.price_list_id = pl.id)
    ), false)
  )
  FROM catalog_config cc
  LEFT JOIN price_lists pl ON pl.user_id = cc.user_id AND pl.kind = 'reseller'
  WHERE cc.slug = btrim(p_slug);
$$;

CREATE OR REPLACE FUNCTION get_public_catalog_products(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'categoryId', p.category_id,
      'category', p.category,
      'salePrice', round(GREATEST(p.sale_price, 0)),
      'stock', p.stock,
      'imageUrl', p.image_url,
      'images', COALESCE(to_jsonb(p.images), '[]'::jsonb),
      'description', p.description,
      'availability', CASE WHEN p.stock > 0 THEN 'in_stock' ELSE 'out_of_stock' END
    ) ORDER BY p.created_at, p.name
  ), '[]'::jsonb)
  FROM catalog_config cc
  JOIN products p ON p.user_id = cc.user_id
  WHERE cc.slug = btrim(p_slug)
    AND cc.enabled
    AND p.show_in_catalog
    AND (cc.show_out_of_stock OR p.stock > 0);
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
  WHERE pli.price_list_id = v_list.id;

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

CREATE OR REPLACE FUNCTION create_public_catalog_order(
  p_slug text,
  p_channel text,
  p_access_code text,
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
  v_list price_lists;
  v_product products;
  v_list_item price_list_items;
  v_input jsonb;
  v_product_id uuid;
  v_seen_product_ids uuid[] := ARRAY[]::uuid[];
  v_quantity integer;
  v_unit_price numeric;
  v_total numeric := 0;
  v_total_quantity integer := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_name text := btrim(COALESCE(p_customer->>'name', ''));
  v_phone text := btrim(COALESCE(p_customer->>'phone', ''));
  v_email text := btrim(COALESCE(p_customer->>'email', ''));
  v_address text := btrim(COALESCE(p_customer->>'address', ''));
  v_message text := btrim(COALESCE(p_customer->>'message', ''));
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('retail', 'reseller') THEN
    RAISE EXCEPTION 'Canal de venta invalido';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'El pedido no contiene productos validos';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_phone) < 5 OR char_length(v_address) < 3 THEN
    RAISE EXCEPTION 'Completa nombre, WhatsApp y direccion';
  END IF;
  IF char_length(v_name) > 120 OR char_length(v_phone) > 40 OR char_length(v_email) > 160
     OR char_length(v_address) > 300 OR char_length(v_message) > 1000 THEN
    RAISE EXCEPTION 'Los datos del cliente son demasiado largos';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Email invalido';
  END IF;

  SELECT * INTO v_config
  FROM catalog_config
  WHERE slug = btrim(p_slug) AND enabled AND allow_orders;
  IF v_config.id IS NULL THEN
    RAISE EXCEPTION 'El catalogo no esta disponible para pedidos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM orders
    WHERE user_id = v_config.user_id
      AND customer_phone = v_phone
      AND created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'Espera unos segundos antes de enviar otro pedido';
  END IF;

  IF p_channel = 'reseller' THEN
    SELECT * INTO v_list
    FROM price_lists
    WHERE user_id = v_config.user_id
      AND kind = 'reseller'
      AND public_enabled
      AND access_code_hash = encode(
        extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'),
        'hex'
      );
    IF v_list.id IS NULL THEN
      RAISE EXCEPTION 'Codigo de acceso invalido';
    END IF;
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE(v_input->>'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(v_input->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Producto o cantidad invalida';
    END IF;
    v_product_id := (v_input->>'productId')::uuid;
    v_quantity := (v_input->>'quantity')::integer;
    IF v_quantity < 1 OR v_quantity > 9999 OR v_product_id = ANY(v_seen_product_ids) THEN
      RAISE EXCEPTION 'Producto o cantidad invalida';
    END IF;
    v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

    SELECT * INTO v_product
    FROM products
    WHERE id = v_product_id AND user_id = v_config.user_id;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Producto no disponible';
    END IF;

    IF p_channel = 'retail' THEN
      IF NOT v_product.show_in_catalog OR (NOT v_config.show_out_of_stock AND v_product.stock <= 0) THEN
        RAISE EXCEPTION 'Producto no disponible';
      END IF;
      IF NOT v_config.show_out_of_stock AND v_quantity > v_product.stock THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_product.name;
      END IF;
      v_unit_price := round(GREATEST(v_product.sale_price, 0));
    ELSE
      SELECT * INTO v_list_item
      FROM price_list_items
      WHERE price_list_id = v_list.id AND product_id = v_product.id;
      IF v_list_item.id IS NULL THEN
        RAISE EXCEPTION 'Producto no disponible';
      END IF;
      IF v_list_item.availability = 'in_stock' AND v_quantity > v_product.stock THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_product.name;
      END IF;
      v_unit_price := CASE
        WHEN v_list_item.pricing_mode = 'fixed' THEN round(GREATEST(v_list_item.fixed_price, 0))
        WHEN v_list_item.pricing_mode = 'discount' THEN round(GREATEST(v_product.sale_price, 0) * (1 - v_list_item.discount_percent / 100))
        ELSE round(GREATEST(v_product.sale_price, 0) * (1 - v_list.default_discount_percent / 100))
      END;
    END IF;

    v_total := v_total + (v_unit_price * v_quantity);
    v_total_quantity := v_total_quantity + v_quantity;
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'price', v_unit_price,
      'availability', CASE WHEN p_channel = 'reseller' THEN v_list_item.availability ELSE NULL END
    ));
  END LOOP;

  IF p_channel = 'reseller' THEN
    IF v_list.minimum_rule IN ('amount', 'both') AND v_total < v_list.minimum_order_amount THEN
      RAISE EXCEPTION 'El pedido no alcanza el monto minimo';
    END IF;
    IF v_list.minimum_rule IN ('quantity', 'both') AND v_total_quantity < v_list.minimum_order_quantity THEN
      RAISE EXCEPTION 'El pedido no alcanza la cantidad minima';
    END IF;
  END IF;

  INSERT INTO orders (
    user_id, date, customer_name, customer_phone, customer_email,
    customer_address, customer_message, items, total, status, is_read,
    channel, price_list_id
  ) VALUES (
    v_config.user_id, CURRENT_DATE, v_name, v_phone, v_email,
    v_address, NULLIF(v_message, ''), v_order_items, v_total, 'Nuevo', false,
    p_channel, CASE WHEN p_channel = 'reseller' THEN v_list.id ELSE NULL END
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object('id', v_order_id, 'total', v_total, 'channel', p_channel);
END;
$$;

REVOKE ALL ON FUNCTION configure_reseller_price_list(uuid, boolean, text, text, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reseller_catalog_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_catalog_products(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION unlock_reseller_catalog(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_public_catalog_order(text, text, text, jsonb, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION configure_reseller_price_list(uuid, boolean, text, text, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_reseller_catalog_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_catalog_products(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION unlock_reseller_catalog(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_public_catalog_order(text, text, text, jsonb, jsonb) TO anon, authenticated;

COMMIT;

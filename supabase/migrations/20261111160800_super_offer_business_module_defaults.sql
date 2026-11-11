BEGIN;

CREATE OR REPLACE FUNCTION public.business_module_enabled(p_owner uuid, p_module text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_modules jsonb := public.business_limits(p_owner)->'modules';
  v_value jsonb;
BEGIN
  IF p_owner IS NULL OR p_module IS NULL THEN
    RETURN false;
  END IF;
  IF p_module NOT IN (
    'sales', 'quotes', 'orders', 'quickPrice', 'stock', 'intake', 'sendPhotos',
    'customers', 'suppliers', 'resellers', 'supplierOrders', 'cash', 'reports',
    'calculator', 'ai', 'knowledge', 'automation', 'traceability'
  ) THEN
    RETURN false;
  END IF;

  v_value := v_modules->p_module;
  IF jsonb_typeof(v_value) = 'boolean' THEN
    RETURN v_value = 'true'::jsonb;
  END IF;

  RETURN CASE p_module
    WHEN 'sales' THEN true
    WHEN 'quotes' THEN true
    WHEN 'orders' THEN true
    WHEN 'quickPrice' THEN true
    WHEN 'stock' THEN true
    WHEN 'intake' THEN true
    WHEN 'sendPhotos' THEN true
    WHEN 'customers' THEN true
    WHEN 'suppliers' THEN true
    WHEN 'resellers' THEN true
    WHEN 'supplierOrders' THEN true
    WHEN 'cash' THEN true
    WHEN 'reports' THEN true
    WHEN 'calculator' THEN true
    WHEN 'traceability' THEN true
    WHEN 'ai' THEN false
    WHEN 'knowledge' THEN false
    WHEN 'automation' THEN false
    ELSE false
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.business_module_enabled(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.super_offer_require_owner(p_owner uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_owner IS NULL
    OR auth.uid() <> p_owner
    OR NOT public.has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar Súper ofertas';
  END IF;
  IF public.business_status(p_owner) <> 'active' THEN
    RAISE EXCEPTION 'La cuenta está suspendida';
  END IF;
  IF NOT public.business_module_enabled(p_owner, 'resellers') THEN
    RAISE EXCEPTION 'El módulo Revendedores no está incluido en tu plan';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.super_offer_require_owner(uuid) FROM PUBLIC, anon, authenticated;

-- Keep the public catalog and checkout on the same default-module semantics as the owner RPC.
CREATE OR REPLACE FUNCTION public.get_public_super_offer(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.catalog_config;
  v_list public.price_lists;
  v_batch public.super_offer_batches;
  v_products jsonb := '[]'::jsonb;
  v_habitual_markup numeric := 1;
BEGIN
  SELECT * INTO v_config FROM public.catalog_config
    WHERE slug = btrim(p_slug) AND enabled LIMIT 1;
  IF v_config.id IS NULL THEN RETURN jsonb_build_object('active', false, 'products', '[]'::jsonb); END IF;
  IF COALESCE(public.business_status(v_config.user_id), 'active') <> 'active'
     OR NOT public.business_module_enabled(v_config.user_id, 'resellers') THEN
    RETURN jsonb_build_object('active', false, 'products', '[]'::jsonb);
  END IF;
  SELECT * INTO v_list FROM public.price_lists
    WHERE user_id = v_config.user_id AND kind = 'reseller' AND public_enabled LIMIT 1;
  IF v_list.id IS NULL THEN RETURN jsonb_build_object('active', false, 'products', '[]'::jsonb); END IF;

  UPDATE public.super_offer_batches
    SET status = 'closed', closed_at = COALESCE(closed_at, now()), updated_at = now()
    WHERE user_id = v_config.user_id AND status = 'open' AND ends_at <= now();
  SELECT * INTO v_batch FROM public.super_offer_batches
    WHERE user_id = v_config.user_id AND status = 'open' AND ends_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF v_batch.id IS NULL THEN RETURN jsonb_build_object('active', false, 'products', '[]'::jsonb); END IF;

  SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.sale_price / NULLIF(
    CASE WHEN pli.pricing_mode = 'fixed' THEN pli.fixed_price
      WHEN pli.pricing_mode = 'discount' THEN p.sale_price * (1 - pli.discount_percent / 100)
      ELSE p.sale_price * (1 - v_list.default_discount_percent / 100) END, 0) - 1), 1)
  INTO v_habitual_markup
  FROM public.price_list_items pli
  JOIN public.products p ON p.id = pli.product_id AND p.user_id = v_config.user_id
  LEFT JOIN public.reseller_supplier_lists sl ON sl.id = pli.supplier_list_id AND sl.user_id = v_config.user_id
  WHERE pli.price_list_id = v_list.id
    AND p.show_in_catalog
    AND p.sale_price > 0
    AND (pli.supplier_list_id IS NULL OR sl.enabled);
  v_habitual_markup := GREATEST(COALESCE(v_habitual_markup, 1), 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'categoryId', p.category_id,
    'category', p.category,
    'salePrice', round(rp.reseller_price * (1 + v_batch.extra_percent / 100)),
    'strikePrice', CASE WHEN dcalc.discount_percent >= 5 THEN round(candidate_strike) ELSE NULL END,
    'discountPercent', CASE WHEN dcalc.discount_percent >= 5 THEN round(dcalc.discount_percent) ELSE 0 END,
    'imageUrl', p.image_url,
    'images', COALESCE(to_jsonb(p.images), '[]'::jsonb),
    'description', p.description,
    'availability', pli.availability
  ) ORDER BY pli.sort_order, p.name), '[]'::jsonb) INTO v_products
  FROM public.price_list_items pli
  JOIN public.products p ON p.id = pli.product_id AND p.user_id = v_config.user_id
  LEFT JOIN public.reseller_supplier_lists sl ON sl.id = pli.supplier_list_id AND sl.user_id = v_config.user_id
  LEFT JOIN public.super_offer_batch_items bi ON bi.batch_id = v_batch.id AND bi.product_id = p.id
  CROSS JOIN LATERAL (
    SELECT round(CASE WHEN pli.pricing_mode = 'fixed' THEN GREATEST(pli.fixed_price, 0)
      WHEN pli.pricing_mode = 'discount' THEN GREATEST(p.sale_price, 0) * (1 - pli.discount_percent / 100)
      ELSE GREATEST(p.sale_price, 0) * (1 - v_list.default_discount_percent / 100) END) AS reseller_price
  ) rp
  CROSS JOIN LATERAL (
    SELECT CASE WHEN p.show_in_catalog AND p.sale_price > 0 THEN p.sale_price
      ELSE rp.reseller_price * (1 + v_habitual_markup) END AS candidate_strike
  ) strike
  CROSS JOIN LATERAL (
    SELECT CASE WHEN strike.candidate_strike > 0
      THEN GREATEST(0, (strike.candidate_strike - round(rp.reseller_price * (1 + v_batch.extra_percent / 100))) / strike.candidate_strike * 100)
      ELSE 0 END AS discount_percent
  ) dcalc
  WHERE pli.price_list_id = v_list.id
    AND (pli.supplier_list_id IS NULL OR sl.enabled)
    AND rp.reseller_price > 0
    AND (NULLIF(btrim(p.image_url), '') IS NOT NULL OR COALESCE(cardinality(p.images), 0) > 0)
    AND (v_batch.selection_mode = 'all' OR bi.product_id IS NOT NULL)
    AND (COALESCE(p.custom_fields->>'supplierPhotoBrandFlag', 'false') <> 'true' OR COALESCE(bi.allow_branded_photo, false));

  RETURN jsonb_build_object(
    'active', true,
    'batch', jsonb_build_object(
      'id', v_batch.id,
      'endsAt', v_batch.ends_at,
      'extraPercent', v_batch.extra_percent,
      'shippingMode', v_batch.shipping_mode,
      'shippingValue', v_batch.shipping_value,
      'noticeColor', v_batch.notice_color
    ),
    'products', v_products
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_public_super_offer_order(
  p_slug text,
  p_batch_id uuid,
  p_customer jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.catalog_config;
  v_list public.price_lists;
  v_batch public.super_offer_batches;
  v_input jsonb;
  v_product public.products;
  v_item public.price_list_items;
  v_product_id uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_quantity integer;
  v_reseller_price numeric;
  v_offer_price numeric;
  v_subtotal numeric := 0;
  v_shipping numeric := 0;
  v_total numeric := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_order_number bigint;
  v_order_code text;
  v_name text := btrim(COALESCE(p_customer->>'name', ''));
  v_phone text := btrim(COALESCE(p_customer->>'phone', ''));
  v_email text := btrim(COALESCE(p_customer->>'email', ''));
  v_address text := btrim(COALESCE(p_customer->>'address', ''));
  v_message text := btrim(COALESCE(p_customer->>'message', ''));
  v_delivery_method text := lower(btrim(COALESCE(p_customer->>'deliveryMethod', 'pickup')));
BEGIN
  IF p_batch_id IS NULL OR jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'El pedido no contiene productos válidos';
  END IF;
  IF v_delivery_method NOT IN ('pickup', 'shipping') OR char_length(v_name) < 2 OR char_length(v_phone) < 5
     OR (v_delivery_method = 'shipping' AND char_length(v_address) < 3) THEN
    RAISE EXCEPTION 'Completá nombre, WhatsApp y los datos de envío necesarios';
  END IF;
  IF char_length(v_name) > 120 OR char_length(v_phone) > 40 OR char_length(v_email) > 160
     OR char_length(v_address) > 300 OR char_length(v_message) > 1000 THEN
    RAISE EXCEPTION 'Los datos del cliente son demasiado largos';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Email inválido';
  END IF;

  SELECT * INTO v_config FROM public.catalog_config
    WHERE slug = btrim(p_slug) AND enabled AND allow_orders LIMIT 1;
  IF v_config.id IS NULL OR COALESCE(public.business_status(v_config.user_id), 'active') <> 'active'
     OR NOT public.business_module_enabled(v_config.user_id, 'resellers') THEN
    RAISE EXCEPTION 'La tanda no está disponible';
  END IF;
  SELECT * INTO v_batch FROM public.super_offer_batches
    WHERE id = p_batch_id AND user_id = v_config.user_id AND status = 'open' AND ends_at > now();
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'La tanda ya cerró'; END IF;
  SELECT * INTO v_list FROM public.price_lists
    WHERE id = v_batch.price_list_id AND user_id = v_config.user_id AND kind = 'reseller' AND public_enabled;
  IF v_list.id IS NULL THEN RAISE EXCEPTION 'La lista de Revendedores no está disponible'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE user_id = v_config.user_id AND customer_phone = v_phone AND created_at > now() - interval '30 seconds') THEN
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
    IF v_quantity < 1 OR v_quantity > 9999 OR v_product_id = ANY(v_seen) THEN RAISE EXCEPTION 'Producto o cantidad inválida'; END IF;
    v_seen := array_append(v_seen, v_product_id);

    SELECT * INTO v_product FROM public.products p
      WHERE p.id = v_product_id AND p.user_id = v_config.user_id;
    SELECT * INTO v_item FROM public.price_list_items pli
      WHERE pli.price_list_id = v_list.id AND pli.product_id = v_product_id;
    IF v_product.id IS NULL OR v_item.product_id IS NULL
      OR (v_batch.selection_mode = 'selected' AND NOT EXISTS (
        SELECT 1 FROM public.super_offer_batch_items bi WHERE bi.batch_id = v_batch.id AND bi.product_id = v_product_id
      ))
      OR (v_item.supplier_list_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.reseller_supplier_lists sl WHERE sl.id = v_item.supplier_list_id AND sl.enabled
      ))
      OR (COALESCE(v_product.custom_fields->>'supplierPhotoBrandFlag', 'false') = 'true' AND NOT EXISTS (
        SELECT 1 FROM public.super_offer_batch_items bi WHERE bi.batch_id = v_batch.id AND bi.product_id = v_product_id AND bi.allow_branded_photo
      ))
      OR (NULLIF(btrim(v_product.image_url), '') IS NULL AND COALESCE(cardinality(v_product.images), 0) = 0) THEN
      RAISE EXCEPTION 'Producto no disponible en esta tanda';
    END IF;

    v_reseller_price := round(CASE
      WHEN v_item.pricing_mode = 'fixed' THEN GREATEST(v_item.fixed_price, 0)
      WHEN v_item.pricing_mode = 'discount' THEN GREATEST(v_product.sale_price, 0) * (1 - v_item.discount_percent / 100)
      ELSE GREATEST(v_product.sale_price, 0) * (1 - v_list.default_discount_percent / 100)
    END);
    IF v_reseller_price <= 0 THEN RAISE EXCEPTION 'El producto ya no tiene precio'; END IF;
    v_offer_price := round(v_reseller_price * (1 + v_batch.extra_percent / 100));
    v_subtotal := v_subtotal + v_offer_price * v_quantity;
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'price', v_offer_price
    ));
  END LOOP;

  v_shipping := round(CASE WHEN v_batch.shipping_mode = 'fixed'
    THEN v_batch.shipping_value ELSE v_subtotal * v_batch.shipping_value / 100 END);
  v_total := v_subtotal + v_shipping;

  INSERT INTO public.catalog_order_counters (user_id, last_number)
  VALUES (v_config.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET last_number = public.catalog_order_counters.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_order_number;
  v_order_code := 'P-' || CASE WHEN v_order_number < 10000 THEN lpad(v_order_number::text, 4, '0') ELSE v_order_number::text END;

  INSERT INTO public.orders (
    user_id, date, customer_name, customer_phone, customer_email, customer_address,
    customer_message, items, total, status, is_read, channel, price_list_id,
    order_code, delivery_method, order_origin, shipping_amount, super_offer_batch_id
  ) VALUES (
    v_config.user_id, CURRENT_DATE, v_name, v_phone, v_email, v_address,
    NULLIF(v_message, ''), v_order_items, v_total, 'Nuevo', false, 'retail', v_list.id,
    v_order_code, v_delivery_method, 'super_offer', v_shipping, v_batch.id
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'orderCode', v_order_code,
    'subtotal', v_subtotal,
    'shippingAmount', v_shipping,
    'total', v_total,
    'channel', 'retail',
    'orderOrigin', 'super_offer',
    'items', v_order_items
  );
END;
$$;

COMMIT;

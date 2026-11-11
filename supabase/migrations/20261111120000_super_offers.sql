BEGIN;

CREATE TABLE public.super_offer_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  catalog_config_id uuid NOT NULL REFERENCES public.catalog_config(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  selection_mode text NOT NULL DEFAULT 'all' CHECK (selection_mode IN ('all', 'selected')),
  extra_percent numeric NOT NULL DEFAULT 20 CHECK (extra_percent BETWEEN 0 AND 500),
  shipping_mode text NOT NULL DEFAULT 'fixed' CHECK (shipping_mode IN ('fixed', 'percent')),
  shipping_value numeric NOT NULL DEFAULT 5000 CHECK (shipping_value >= 0 AND (shipping_mode = 'fixed' OR shipping_value <= 100)),
  ends_at timestamptz NOT NULL,
  notice_color text NOT NULL DEFAULT 'red' CHECK (notice_color IN ('red', 'orange', 'violet', 'blue')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.super_offer_batch_items (
  batch_id uuid NOT NULL REFERENCES public.super_offer_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  allow_branded_photo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, product_id)
);

CREATE UNIQUE INDEX super_offer_one_open_per_business_idx
  ON public.super_offer_batches(user_id) WHERE status = 'open';
CREATE INDEX super_offer_batch_user_recent_idx
  ON public.super_offer_batches(user_id, created_at DESC);
CREATE INDEX super_offer_batch_items_user_idx
  ON public.super_offer_batch_items(user_id, batch_id);

ALTER TABLE public.super_offer_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_offer_batch_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.super_offer_batches, public.super_offer_batch_items FROM PUBLIC, anon, authenticated;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_origin text,
  ADD COLUMN IF NOT EXISTS shipping_amount numeric,
  ADD COLUMN IF NOT EXISTS super_offer_batch_id uuid REFERENCES public.super_offer_batches(id) ON DELETE SET NULL;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_origin_check
    CHECK (order_origin IS NULL OR order_origin IN ('catalog', 'super_offer')),
  ADD CONSTRAINT orders_shipping_amount_check
    CHECK (shipping_amount IS NULL OR shipping_amount >= 0);
CREATE INDEX orders_super_offer_batch_idx ON public.orders(super_offer_batch_id) WHERE super_offer_batch_id IS NOT NULL;

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
  IF COALESCE(public.business_limits(p_owner)->'modules'->>'resellers', 'false') <> 'true' THEN
    RAISE EXCEPTION 'El módulo Revendedores no está incluido en tu plan';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.super_offer_require_owner(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_owner_super_offer_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_list public.price_lists;
  v_config public.catalog_config;
  v_latest jsonb;
  v_orders integer := 0;
BEGIN
  PERFORM public.super_offer_require_owner(v_owner);
  SELECT * INTO v_list FROM public.price_lists
    WHERE user_id = v_owner AND kind = 'reseller' LIMIT 1;
  SELECT * INTO v_config FROM public.catalog_config WHERE user_id = v_owner LIMIT 1;
  IF v_list.id IS NULL OR v_config.id IS NULL THEN
    RAISE EXCEPTION 'Configurá primero el catálogo y la lista de Revendedores';
  END IF;

  UPDATE public.super_offer_batches
    SET status = 'closed', closed_at = COALESCE(closed_at, now()), updated_at = now()
    WHERE user_id = v_owner AND status = 'open' AND ends_at <= now();

  SELECT jsonb_build_object(
    'id', b.id,
    'status', b.status,
    'selectionMode', b.selection_mode,
    'extraPercent', b.extra_percent,
    'shippingMode', b.shipping_mode,
    'shippingValue', b.shipping_value,
    'endsAt', b.ends_at,
    'noticeColor', b.notice_color,
    'createdAt', b.created_at,
    'productIds', COALESCE((SELECT jsonb_agg(i.product_id) FROM public.super_offer_batch_items i WHERE i.batch_id = b.id AND (b.selection_mode = 'selected' OR i.allow_branded_photo)), '[]'::jsonb),
    'brandedProductIds', COALESCE((SELECT jsonb_agg(i.product_id) FROM public.super_offer_batch_items i WHERE i.batch_id = b.id AND i.allow_branded_photo), '[]'::jsonb)
  ) INTO v_latest
  FROM public.super_offer_batches b
  WHERE b.user_id = v_owner
  ORDER BY b.created_at DESC
  LIMIT 1;

  IF v_latest->>'id' IS NOT NULL THEN
    SELECT count(*)::integer INTO v_orders
    FROM public.orders o WHERE o.super_offer_batch_id = (v_latest->>'id')::uuid;
    v_latest := v_latest || jsonb_build_object('ordersCount', v_orders);
  END IF;

  RETURN jsonb_build_object(
    'batch', v_latest,
    'slug', v_config.slug,
    'catalogEnabled', v_config.enabled,
    'resellerEnabled', v_list.public_enabled
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_super_offer_batch(
  p_batch_id uuid,
  p_selection_mode text,
  p_extra_percent numeric,
  p_shipping_mode text,
  p_shipping_value numeric,
  p_ends_at timestamptz,
  p_notice_color text,
  p_product_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_allow_branded_product_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_open boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_list public.price_lists;
  v_config public.catalog_config;
  v_batch public.super_offer_batches;
BEGIN
  PERFORM public.super_offer_require_owner(v_owner);
  IF p_selection_mode NOT IN ('all', 'selected') OR p_shipping_mode NOT IN ('fixed', 'percent')
     OR p_notice_color NOT IN ('red', 'orange', 'violet', 'blue')
     OR p_extra_percent NOT BETWEEN 0 AND 500 OR p_shipping_value < 0
     OR (p_shipping_mode = 'percent' AND p_shipping_value > 100)
     OR p_ends_at <= now() OR p_ends_at > now() + interval '1 year' THEN
    RAISE EXCEPTION 'Revisá los valores de la tanda';
  END IF;
  IF p_selection_mode = 'selected' AND COALESCE(cardinality(p_product_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Elegí al menos un producto';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_owner::text));
  UPDATE public.super_offer_batches
    SET status = 'closed', closed_at = COALESCE(closed_at, now()), updated_at = now()
    WHERE user_id = v_owner AND status = 'open' AND ends_at <= now();

  SELECT * INTO v_list FROM public.price_lists
    WHERE user_id = v_owner AND kind = 'reseller' AND public_enabled LIMIT 1;
  SELECT * INTO v_config FROM public.catalog_config
    WHERE user_id = v_owner AND enabled LIMIT 1;
  IF v_list.id IS NULL OR v_config.id IS NULL THEN
    RAISE EXCEPTION 'Publicá el catálogo y la lista de Revendedores antes de abrir una tanda';
  END IF;

  IF p_batch_id IS NULL THEN
    INSERT INTO public.super_offer_batches (
      user_id, catalog_config_id, price_list_id, selection_mode, extra_percent,
      shipping_mode, shipping_value, ends_at, notice_color, status, opened_at
    ) VALUES (
      v_owner, v_config.id, v_list.id, p_selection_mode, p_extra_percent,
      p_shipping_mode, p_shipping_value, p_ends_at, p_notice_color,
      CASE WHEN p_open THEN 'open' ELSE 'draft' END,
      CASE WHEN p_open THEN now() ELSE NULL END
    ) RETURNING * INTO v_batch;
  ELSE
    UPDATE public.super_offer_batches
    SET catalog_config_id = v_config.id,
        price_list_id = v_list.id,
        selection_mode = p_selection_mode,
        extra_percent = p_extra_percent,
        shipping_mode = p_shipping_mode,
        shipping_value = p_shipping_value,
        ends_at = p_ends_at,
        notice_color = p_notice_color,
        status = CASE WHEN p_open THEN 'open' ELSE status END,
        opened_at = CASE WHEN p_open THEN COALESCE(opened_at, now()) ELSE opened_at END,
        closed_at = CASE WHEN p_open THEN NULL ELSE closed_at END,
        updated_at = now()
    WHERE id = p_batch_id AND user_id = v_owner
    RETURNING * INTO v_batch;
    IF v_batch.id IS NULL THEN RAISE EXCEPTION 'No encontramos esa tanda'; END IF;
  END IF;

  DELETE FROM public.super_offer_batch_items WHERE batch_id = v_batch.id AND user_id = v_owner;
  IF p_selection_mode = 'selected' THEN
    IF EXISTS (
      SELECT 1 FROM unnest(COALESCE(p_product_ids, ARRAY[]::uuid[])) chosen(id)
      LEFT JOIN public.price_list_items pli ON pli.price_list_id = v_list.id AND pli.product_id = chosen.id
      LEFT JOIN public.products p ON p.id = chosen.id AND p.user_id = v_owner
      WHERE pli.product_id IS NULL OR p.id IS NULL
        OR round(CASE WHEN pli.pricing_mode = 'fixed' THEN GREATEST(pli.fixed_price, 0)
          WHEN pli.pricing_mode = 'discount' THEN GREATEST(p.sale_price, 0) * (1 - pli.discount_percent / 100)
          ELSE GREATEST(p.sale_price, 0) * (1 - v_list.default_discount_percent / 100) END) <= 0
        OR (COALESCE(cardinality(p.images), 0) = 0 AND NULLIF(btrim(p.image_url), '') IS NULL)
    ) THEN RAISE EXCEPTION 'La selección contiene productos sin precio o foto'; END IF;
    INSERT INTO public.super_offer_batch_items(batch_id, user_id, product_id, allow_branded_photo)
    SELECT v_batch.id, v_owner, chosen.id, chosen.id = ANY(COALESCE(p_allow_branded_product_ids, ARRAY[]::uuid[]))
    FROM unnest(COALESCE(p_product_ids, ARRAY[]::uuid[])) chosen(id);
  ELSE
    IF EXISTS (
      SELECT 1 FROM unnest(COALESCE(p_allow_branded_product_ids, ARRAY[]::uuid[])) chosen(id)
      LEFT JOIN public.price_list_items pli ON pli.price_list_id = v_list.id AND pli.product_id = chosen.id
      LEFT JOIN public.products p ON p.id = chosen.id AND p.user_id = v_owner
      WHERE pli.product_id IS NULL OR p.id IS NULL OR COALESCE(p.custom_fields->>'supplierPhotoBrandFlag', 'false') <> 'true'
        OR round(CASE WHEN pli.pricing_mode = 'fixed' THEN GREATEST(pli.fixed_price, 0)
          WHEN pli.pricing_mode = 'discount' THEN GREATEST(p.sale_price, 0) * (1 - pli.discount_percent / 100)
          ELSE GREATEST(p.sale_price, 0) * (1 - v_list.default_discount_percent / 100) END) <= 0
        OR (COALESCE(cardinality(p.images), 0) = 0 AND NULLIF(btrim(p.image_url), '') IS NULL)
    ) THEN RAISE EXCEPTION 'La selección de fotos marcadas no es válida'; END IF;
    INSERT INTO public.super_offer_batch_items(batch_id, user_id, product_id, allow_branded_photo)
    SELECT v_batch.id, v_owner, chosen.id, true
    FROM unnest(COALESCE(p_allow_branded_product_ids, ARRAY[]::uuid[])) chosen(id);
  END IF;

  RETURN jsonb_build_object('id', v_batch.id, 'status', v_batch.status, 'endsAt', v_batch.ends_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_super_offer_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  PERFORM public.super_offer_require_owner(v_owner);
  UPDATE public.super_offer_batches
    SET status = 'closed', closed_at = now(), updated_at = now()
    WHERE id = p_batch_id AND user_id = v_owner AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay una tanda abierta para cerrar'; END IF;
END;
$$;

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
     OR COALESCE(public.business_limits(v_config.user_id)->'modules'->>'resellers', 'false') <> 'true' THEN
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
     OR COALESCE(public.business_limits(v_config.user_id)->'modules'->>'resellers', 'false') <> 'true' THEN
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

REVOKE ALL ON FUNCTION public.get_owner_super_offer_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_super_offer_batch(uuid, text, numeric, text, numeric, timestamptz, text, uuid[], uuid[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_super_offer_batch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_super_offer(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_public_super_offer_order(text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_owner_super_offer_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_super_offer_batch(uuid, text, numeric, text, numeric, timestamptz, text, uuid[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_super_offer_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_super_offer(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_super_offer_order(text, uuid, jsonb, jsonb) TO anon, authenticated;

COMMIT;

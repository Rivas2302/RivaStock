BEGIN;

ALTER TABLE public.super_offer_batches
  ADD COLUMN show_compare_price boolean NOT NULL DEFAULT false;

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
    'showComparePrice', b.show_compare_price,
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

CREATE OR REPLACE FUNCTION public.save_super_offer_batch_with_compare_price(
  p_batch_id uuid,
  p_selection_mode text,
  p_extra_percent numeric,
  p_shipping_mode text,
  p_shipping_value numeric,
  p_ends_at timestamptz,
  p_notice_color text,
  p_product_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_allow_branded_product_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_open boolean DEFAULT false,
  p_show_compare_price boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_saved jsonb;
  v_batch_id uuid;
BEGIN
  v_saved := public.save_super_offer_batch(
    p_batch_id,
    p_selection_mode,
    p_extra_percent,
    p_shipping_mode,
    p_shipping_value,
    p_ends_at,
    p_notice_color,
    p_product_ids,
    p_allow_branded_product_ids,
    p_open
  );
  v_batch_id := NULLIF(v_saved->>'id', '')::uuid;

  UPDATE public.super_offer_batches
    SET show_compare_price = p_show_compare_price
    WHERE id = v_batch_id AND user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos esa tanda'; END IF;

  RETURN v_saved || jsonb_build_object('showComparePrice', p_show_compare_price);
END;
$$;

REVOKE ALL ON FUNCTION public.save_super_offer_batch_with_compare_price(uuid, text, numeric, text, numeric, timestamptz, text, uuid[], uuid[], boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_super_offer_batch_with_compare_price(uuid, text, numeric, text, numeric, timestamptz, text, uuid[], uuid[], boolean, boolean) TO authenticated;

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
    'salePrice', round(rp.reseller_price * (1 + v_batch.extra_percent / 100))
  ) || CASE WHEN v_batch.show_compare_price THEN jsonb_build_object(
    'strikePrice', CASE WHEN dcalc.discount_percent >= 5 THEN round(candidate_strike) ELSE NULL END,
    'discountPercent', CASE WHEN dcalc.discount_percent >= 5 THEN round(dcalc.discount_percent) ELSE 0 END
  ) ELSE '{}'::jsonb END || jsonb_build_object(
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
      'shippingMode', v_batch.shipping_mode,
      'shippingValue', v_batch.shipping_value,
      'noticeColor', v_batch.notice_color,
      'showComparePrice', v_batch.show_compare_price
    ) || CASE WHEN v_batch.show_compare_price
      THEN jsonb_build_object('extraPercent', v_batch.extra_percent)
      ELSE '{}'::jsonb END,
    'products', v_products
  );
END;
$$;

COMMIT;

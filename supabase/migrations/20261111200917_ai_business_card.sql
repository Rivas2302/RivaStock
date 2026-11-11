BEGIN;

CREATE OR REPLACE FUNCTION public.ai_business_card(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_plan_name text;
  v_limits jsonb;
  v_module_defaults jsonb := '{
    "sales":true,"quotes":true,"orders":true,"quickPrice":true,
    "stock":true,"intake":true,"sendPhotos":true,"customers":true,
    "suppliers":true,"resellers":true,"supplierOrders":true,"cash":true,
    "reports":true,"calculator":true,"ai":false,"knowledge":false,
    "automation":false,"traceability":true
  }'::jsonb;
  v_modules jsonb;
  v_module_names jsonb;
  v_catalog jsonb;
  v_counts jsonb;
  v_local_now timestamp;
BEGIN
  IF p_owner IS NULL THEN RAISE EXCEPTION 'Dueño inválido'; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_owner;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT COALESCE(plan.name, subscription.plan_code, 'Base') INTO v_plan_name
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.business_subscriptions AS subscription ON subscription.owner_uid = p_owner
  LEFT JOIN public.business_plans AS plan ON plan.code = subscription.plan_code;

  v_limits := COALESCE(public.business_limits(p_owner), '{}'::jsonb);
  v_modules := v_module_defaults || COALESCE(v_limits->'modules', '{}'::jsonb);
  SELECT COALESCE(jsonb_agg(module.key ORDER BY module.key), '[]'::jsonb)
    INTO v_module_names
  FROM jsonb_each(v_modules) AS module(key, value)
  WHERE jsonb_typeof(module.value) = 'boolean' AND module.value = 'true'::jsonb;

  SELECT jsonb_build_object(
    'products', (SELECT count(*) FROM public.products AS product WHERE product.user_id = p_owner),
    'products_without_photo', (SELECT count(*) FROM public.products AS product
      WHERE product.user_id = p_owner AND NULLIF(btrim(product.image_url), '') IS NULL
        AND COALESCE(cardinality(product.images), 0) = 0),
    'products_without_price', (SELECT count(*) FROM public.products AS product
      WHERE product.user_id = p_owner AND product.sale_price <= 0),
    'low_stock', (SELECT count(*) FROM public.products AS product
      WHERE product.user_id = p_owner AND product.stock <= product.min_stock),
    'pending_orders', (SELECT count(*) FROM public.orders AS orders
      WHERE orders.user_id = p_owner AND orders.status IN ('Nuevo', 'En Proceso')),
    'customers', (SELECT count(*) FROM public.customers AS customer WHERE customer.user_id = p_owner)
  ) INTO v_counts;

  SELECT jsonb_build_object(
    'public_url', CASE WHEN config.enabled THEN 'https://rivastock.vercel.app/p/' || config.slug ELSE NULL END,
    'has_reseller_mode', EXISTS (
      SELECT 1 FROM public.reseller_supplier_lists AS supplier_list
      JOIN public.price_lists AS price_list
        ON price_list.id = supplier_list.price_list_id AND price_list.user_id = supplier_list.user_id
      WHERE supplier_list.user_id = p_owner AND supplier_list.enabled AND price_list.kind = 'reseller'
    )
  ) INTO v_catalog
  FROM public.catalog_config AS config
  WHERE config.user_id = p_owner
  ORDER BY config.updated_at DESC
  LIMIT 1;

  v_local_now := now() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'business_name', NULLIF(btrim(v_profile.business_name), ''),
    'owner_display_name', NULLIF(btrim(v_profile.display_name), ''),
    'plan', v_plan_name,
    'modules', v_module_names,
    'counts', v_counts,
    'catalog', v_catalog,
    'currency_symbol', NULLIF(v_profile.currency_symbol, ''),
    'timezone', 'America/Argentina/Buenos_Aires',
    'now_local', to_char(v_local_now, 'YYYY-MM-DD"T"HH24:MI:SS')
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.ai_business_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_business_card(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

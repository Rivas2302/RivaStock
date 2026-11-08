-- I32: make imported supplier products removable as a scoped, retryable operation.
-- The one-time adoption below links the exact legacy Mr Tecno batch that was
-- verified in production on 2026-11-07. The supplier list remains disabled.

BEGIN;

CREATE TABLE public.reseller_supplier_import_categories (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  supplier_list_id uuid NOT NULL REFERENCES public.reseller_supplier_lists(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_list_id, category_id)
);

CREATE INDEX reseller_supplier_import_categories_owner_idx
  ON public.reseller_supplier_import_categories(user_id, supplier_list_id);

ALTER TABLE public.reseller_supplier_import_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY reseller_supplier_import_categories_select_owner
  ON public.reseller_supplier_import_categories
  FOR SELECT TO authenticated
  USING (user_id = public.get_owner_uid(auth.uid()));

-- Link the exact legacy import batch, without publishing it or changing products.
DO $$
DECLARE
  v_candidate_count integer;
  v_owner_count integer;
  v_price_list_count integer;
BEGIN
  WITH candidates AS (
    SELECT p.id, p.user_id
    FROM public.products p
    JOIN public.suppliers s ON s.user_id = p.user_id
    WHERE lower(btrim(s.name)) = 'mr tecno'
      AND p.created_at >= timestamptz '2026-11-07 21:00:00-03'
      AND p.created_at < timestamptz '2026-11-07 22:00:00-03'
      AND p.catalog_only = true
      AND p.catalog_cost > 0
      AND nullif(btrim(p.barcode), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.reseller_supplier_list_items linked
        WHERE linked.user_id = p.user_id AND linked.product_id = p.id
      )
  )
  SELECT count(*), count(DISTINCT user_id)
  INTO v_candidate_count, v_owner_count
  FROM candidates;

  IF v_candidate_count = 0 THEN
    RETURN;
  END IF;
  IF v_candidate_count <> 867 OR v_owner_count <> 1 THEN
    RAISE EXCEPTION 'I32 legacy import adoption stopped: the verified product batch no longer matches.';
  END IF;

  SELECT count(DISTINCT pl.id)
  INTO v_price_list_count
  FROM public.price_lists pl
  JOIN public.suppliers s ON s.user_id = pl.user_id
  WHERE lower(btrim(s.name)) = 'mr tecno'
    AND pl.kind = 'reseller';

  IF v_price_list_count <> 1 THEN
    RAISE EXCEPTION 'I32 legacy import adoption stopped: expected one reseller price list.';
  END IF;

  INSERT INTO public.reseller_supplier_lists (user_id, price_list_id, supplier_id, enabled)
  SELECT DISTINCT pl.user_id, pl.id, s.id, false
  FROM public.suppliers s
  JOIN public.price_lists pl ON pl.user_id = s.user_id AND pl.kind = 'reseller'
  WHERE lower(btrim(s.name)) = 'mr tecno'
  ON CONFLICT (price_list_id, supplier_id) DO NOTHING;

  INSERT INTO public.reseller_supplier_list_items (user_id, supplier_list_id, product_id, sort_order)
  SELECT p.user_id, supplier_list.id, p.id,
         row_number() OVER (PARTITION BY p.user_id ORDER BY p.created_at, p.id)::integer - 1
  FROM public.products p
  JOIN public.suppliers s ON s.user_id = p.user_id
  JOIN public.reseller_supplier_lists supplier_list
    ON supplier_list.user_id = s.user_id AND supplier_list.supplier_id = s.id
  WHERE lower(btrim(s.name)) = 'mr tecno'
    AND p.created_at >= timestamptz '2026-11-07 21:00:00-03'
    AND p.created_at < timestamptz '2026-11-07 22:00:00-03'
    AND p.catalog_only = true
    AND p.catalog_cost > 0
    AND nullif(btrim(p.barcode), '') IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_candidate_count = ROW_COUNT;
  IF v_candidate_count <> 867 THEN
    RAISE EXCEPTION 'I32 legacy import adoption stopped: not all verified products were linked.';
  END IF;

  INSERT INTO public.reseller_supplier_import_categories (user_id, supplier_list_id, category_id)
  SELECT DISTINCT p.user_id, supplier_list.id, category.id
  FROM public.products p
  JOIN public.suppliers s ON s.user_id = p.user_id
  JOIN public.reseller_supplier_lists supplier_list
    ON supplier_list.user_id = s.user_id AND supplier_list.supplier_id = s.id
  JOIN public.categories category
    ON category.user_id = p.user_id AND category.id::text = p.category_id
  WHERE lower(btrim(s.name)) = 'mr tecno'
    AND p.created_at >= timestamptz '2026-11-07 21:00:00-03'
    AND p.created_at < timestamptz '2026-11-07 22:00:00-03'
    AND p.catalog_only = true
    AND p.catalog_cost > 0
    AND nullif(btrim(p.barcode), '') IS NOT NULL
    AND category.created_at >= timestamptz '2026-11-07 21:00:00-03'
    AND category.created_at < timestamptz '2026-11-07 22:00:00-03'
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_reseller_supplier_import_categories(
  p_supplier_list_id uuid,
  p_category_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.get_owner_uid(auth.uid());
  v_ids uuid[] := COALESCE(p_category_ids, ARRAY[]::uuid[]);
  v_saved integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para administrar listas por proveedor';
  END IF;
  IF cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'La importación no puede crear más de 500 categorías';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reseller_supplier_lists
    WHERE id = p_supplier_list_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Lista de proveedor no encontrada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) category_id
    LEFT JOIN public.categories c ON c.id = category_id AND c.user_id = v_uid
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'La importación contiene categorías inválidas';
  END IF;

  INSERT INTO public.reseller_supplier_import_categories (user_id, supplier_list_id, category_id)
  SELECT v_uid, p_supplier_list_id, category_id FROM unnest(v_ids) category_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN v_saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_supplier_product_has_history(
  p_product_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference record;
  v_found boolean;
BEGIN
  FOR v_reference IN
    SELECT c.table_name,
           bool_or(c.column_name = 'user_id') AS has_user_id,
           bool_or(c.column_name = 'owner_uid') AS has_owner_uid
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('product_id', 'user_id', 'owner_uid')
      AND c.table_name NOT IN (
        'price_list_items',
        'reseller_supplier_list_items',
        'reseller_supplier_list_pricing'
      )
    GROUP BY c.table_name
    HAVING bool_or(c.column_name = 'product_id')
       AND (bool_or(c.column_name = 'user_id') OR bool_or(c.column_name = 'owner_uid'))
  LOOP
    IF v_reference.has_user_id THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE product_id::text = $1::text AND user_id::text = $2::text)',
        v_reference.table_name
      ) INTO v_found USING p_product_id, p_user_id;
    ELSE
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE product_id::text = $1::text AND owner_uid::text = $2::text)',
        v_reference.table_name
      ) INTO v_found USING p_product_id, p_user_id;
    END IF;
    IF v_found THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_reseller_supplier_import_removal(
  p_supplier_list_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.get_owner_uid(auth.uid());
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para quitar productos importados';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reseller_supplier_lists
    WHERE id = p_supplier_list_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Lista de proveedor no encontrada';
  END IF;

  WITH target AS (
    SELECT p.id, p.user_id, p.category_id,
           public.reseller_supplier_product_has_history(p.id, p.user_id) AS has_history,
           ARRAY(SELECT DISTINCT photo_url
                 FROM unnest(COALESCE(p.images, ARRAY[]::text[]) || ARRAY[p.image_url]) photo_url
                 WHERE photo_url IS NOT NULL AND photo_url <> '') AS photos
    FROM public.reseller_supplier_list_items i
    JOIN public.products p ON p.id = i.product_id AND p.user_id = i.user_id
    WHERE i.supplier_list_id = p_supplier_list_id AND i.user_id = v_uid
  ), category_candidates AS (
    SELECT DISTINCT c.id
    FROM public.reseller_supplier_import_categories mapping
    JOIN public.categories c ON c.id = mapping.category_id AND c.user_id = mapping.user_id
    WHERE mapping.user_id = v_uid AND mapping.supplier_list_id = p_supplier_list_id
      AND NOT EXISTS (
        SELECT 1 FROM public.products remaining
        WHERE remaining.user_id = v_uid AND remaining.category_id = c.id::text
          AND NOT EXISTS (SELECT 1 FROM target t WHERE t.id = remaining.id AND NOT t.has_history)
      )
  )
  SELECT jsonb_build_object(
    'products', count(*),
    'protectedProducts', count(*) FILTER (WHERE has_history),
    'deletableProducts', count(*) FILTER (WHERE NOT has_history),
    'photosToDelete', (SELECT count(DISTINCT t.id || ':' || photo_url)
                       FROM target t CROSS JOIN LATERAL unnest(t.photos) photo_url
                       WHERE NOT t.has_history
                         AND photo_url ~ '/products/[^/]+/supplier-[a-f0-9]{64}\.webp($|[?#])'),
    'emptyCategoriesToDelete', (SELECT count(*) FROM category_candidates)
  ) INTO v_result
  FROM target;

  RETURN COALESCE(v_result, jsonb_build_object(
    'products', 0, 'protectedProducts', 0, 'deletableProducts', 0,
    'photosToDelete', 0, 'emptyCategoriesToDelete', 0
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_reseller_supplier_import_batch(
  p_supplier_list_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.get_owner_uid(auth.uid());
  v_product public.products%ROWTYPE;
  v_processed integer := 0;
  v_deleted integer := 0;
  v_protected integer := 0;
  v_categories_deleted integer := 0;
  v_deleted_category_ids jsonb := '[]'::jsonb;
  v_storage_urls jsonb := '[]'::jsonb;
  v_deleted_product_ids jsonb := '[]'::jsonb;
  v_protected_product_ids jsonb := '[]'::jsonb;
  v_item record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'stock', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para quitar productos importados';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'El tamaño del lote debe estar entre 1 y 100';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reseller_supplier_lists
    WHERE id = p_supplier_list_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Lista de proveedor no encontrada';
  END IF;

  PERFORM 1 FROM public.reseller_supplier_lists
  WHERE id = p_supplier_list_id AND user_id = v_uid FOR UPDATE;

  FOR v_item IN
    SELECT i.product_id
    FROM public.reseller_supplier_list_items i
    WHERE i.supplier_list_id = p_supplier_list_id AND i.user_id = v_uid
    ORDER BY i.sort_order, i.product_id
    LIMIT p_limit
    FOR UPDATE
  LOOP
    SELECT p.* INTO v_product
    FROM public.products p
    WHERE p.id = v_item.product_id AND p.user_id = v_uid
    FOR UPDATE;

    IF v_product.id IS NOT NULL THEN
      IF public.reseller_supplier_product_has_history(v_product.id, v_uid) THEN
        UPDATE public.products
        SET show_in_catalog = false, updated_at = now()
        WHERE id = v_product.id AND user_id = v_uid;
        v_protected_product_ids := v_protected_product_ids || to_jsonb(v_product.id::text);
        v_protected := v_protected + 1;
      ELSE
        v_storage_urls := v_storage_urls || to_jsonb(
          ARRAY(SELECT DISTINCT photo_url
                FROM unnest(COALESCE(v_product.images, ARRAY[]::text[]) || ARRAY[v_product.image_url]) photo_url
                WHERE photo_url IS NOT NULL AND photo_url <> '')
        );
        DELETE FROM public.products WHERE id = v_product.id AND user_id = v_uid;
        v_deleted_product_ids := v_deleted_product_ids || to_jsonb(v_product.id::text);
        v_deleted := v_deleted + 1;
      END IF;
    END IF;

    DELETE FROM public.price_list_items
    WHERE user_id = v_uid AND product_id = v_item.product_id AND supplier_list_id = p_supplier_list_id;
    DELETE FROM public.reseller_supplier_list_items
    WHERE user_id = v_uid AND product_id = v_item.product_id AND supplier_list_id = p_supplier_list_id;
    DELETE FROM public.reseller_supplier_list_pricing
    WHERE user_id = v_uid AND product_id = v_item.product_id AND supplier_list_id = p_supplier_list_id;
    v_processed := v_processed + 1;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.reseller_supplier_list_items
    WHERE supplier_list_id = p_supplier_list_id AND user_id = v_uid
  ) THEN
    FOR v_item IN
      SELECT mapping.category_id
      FROM public.reseller_supplier_import_categories mapping
      WHERE mapping.user_id = v_uid AND mapping.supplier_list_id = p_supplier_list_id
    LOOP
      DELETE FROM public.categories c
      WHERE c.id = v_item.category_id AND c.user_id = v_uid
        AND NOT EXISTS (
          SELECT 1 FROM public.products p
          WHERE p.user_id = v_uid AND p.category_id = c.id::text
        );
      IF FOUND THEN
        v_categories_deleted := v_categories_deleted + 1;
        v_deleted_category_ids := v_deleted_category_ids || to_jsonb(v_item.category_id::text);
      END IF;
    END LOOP;
    DELETE FROM public.reseller_supplier_import_categories
    WHERE user_id = v_uid AND supplier_list_id = p_supplier_list_id;
  END IF;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'deleted', v_deleted,
    'protected', v_protected,
    'deletedProductIds', v_deleted_product_ids,
    'protectedProductIds', v_protected_product_ids,
    'storageUrls', v_storage_urls,
    'emptyCategoriesDeleted', v_categories_deleted,
    'deletedCategoryIds', v_deleted_category_ids,
    'remaining', (SELECT count(*) FROM public.reseller_supplier_list_items
                 WHERE supplier_list_id = p_supplier_list_id AND user_id = v_uid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_reseller_supplier_import_categories(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reseller_supplier_product_has_history(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_reseller_supplier_import_removal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_reseller_supplier_import_batch(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_reseller_supplier_import_categories(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_reseller_supplier_import_removal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_reseller_supplier_import_batch(uuid, integer) TO authenticated;

COMMIT;

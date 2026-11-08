-- I32 follow-up: record only categories created during the verified historical
-- supplier import so cleanup can remove them later if they are still empty.
BEGIN;

DO $$
DECLARE
  v_category_count integer;
  v_inserted_count integer;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT p.user_id, supplier_list.id AS supplier_list_id, category.id AS category_id
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
  )
  SELECT count(*) INTO v_category_count FROM candidates;

  IF v_category_count > 100 THEN
    RAISE EXCEPTION 'I32 category tracking stopped: candidate count exceeds the verified batch.';
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

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count > 100 THEN
    RAISE EXCEPTION 'I32 category tracking stopped: inserted count exceeds the verified batch.';
  END IF;
END;
$$;

COMMIT;

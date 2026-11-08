-- An authenticated owner can clean provider codes from the display names of
-- only the catalog-only products in that owner's selected supplier list.
-- The RPC preserves existing barcodes and lets product audit triggers record
-- each update with the caller's authenticated identity.

CREATE OR REPLACE FUNCTION public.sanitize_reseller_supplier_product_names(p_supplier_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_owner_uid uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_owner_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers supplier
    WHERE supplier.id = p_supplier_id
      AND supplier.user_id = v_owner_uid
  ) THEN
    RAISE EXCEPTION 'Supplier not found or access denied';
  END IF;

  WITH supplier_products AS (
    SELECT
      p.id,
      p.user_id,
      btrim(regexp_replace(
        btrim(p.name),
        '^[[:alnum:]./_-]{2,32}[[:space:]]*[-–—][[:space:]]+',
        ''
      )) AS clean_name
    FROM public.products p
    WHERE p.user_id = v_owner_uid
      AND p.catalog_only = true
      AND EXISTS (
        SELECT 1
        FROM public.reseller_supplier_list_items item
        JOIN public.reseller_supplier_lists supplier_list
          ON supplier_list.id = item.supplier_list_id
         AND supplier_list.user_id = v_owner_uid
        WHERE item.user_id = v_owner_uid
          AND item.product_id = p.id
          AND supplier_list.supplier_id = p_supplier_id
      )
  ), normalized AS (
    SELECT
      id,
      user_id,
      CASE
        WHEN length(regexp_replace(clean_name, '[^[:alpha:]]', '', 'g')) > 0
          AND length(regexp_replace(clean_name, '[^[:upper:]]', '', 'g'))
            >= ceil(length(regexp_replace(clean_name, '[^[:alpha:]]', '', 'g')) * 0.8) THEN
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  upper(left(lower(clean_name), 1)) || substr(lower(clean_name), 2),
                  '\mled\M', 'LED', 'g'
                ),
                '\musb\M', 'USB', 'g'
              ),
              '\mhdmi\M', 'HDMI', 'g'
            ),
            '\mrgb\M', 'RGB', 'g'
          )
        ELSE clean_name
      END AS display_name
    FROM supplier_products
    WHERE clean_name <> ''
  )
  UPDATE public.products p
  SET name = normalized.display_name,
      updated_at = now()
  FROM normalized
  WHERE p.id = normalized.id
    AND p.user_id = normalized.user_id
    AND p.name <> normalized.display_name;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.sanitize_reseller_supplier_product_names(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_reseller_supplier_product_names(uuid) TO authenticated;

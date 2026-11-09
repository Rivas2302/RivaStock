ALTER TABLE public.business_subscriptions
  ADD COLUMN suspension_scheduled_for timestamptz,
  ADD COLUMN suspension_previous_status text CHECK (suspension_previous_status IS NULL OR suspension_previous_status IN ('trial', 'active')),
  ADD COLUMN suspension_notice_sent_at timestamptz,
  ADD COLUMN suspension_notice_error text CHECK (suspension_notice_error IS NULL OR suspension_notice_error ~ '^[a-z0-9_-]{1,40}$');

CREATE OR REPLACE FUNCTION public.business_status(p_owner uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN s.status = 'suspended' OR s.suspension_scheduled_for <= now() THEN 'suspended'
    ELSE COALESCE(s.status, 'active')
  END
  FROM (SELECT p_owner AS owner_uid) requested
  LEFT JOIN public.business_subscriptions s ON s.owner_uid = requested.owner_uid
$$;

CREATE OR REPLACE FUNCTION public.business_require_active(p_owner uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.business_status(p_owner) = 'suspended' THEN
    RAISE EXCEPTION 'La cuenta del negocio está suspendida. Comunicate con RivaTech.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.suspension_business_read_allowed(p_identifier text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_identifier uuid;
  v_row_owner uuid;
  v_caller_owner uuid;
BEGIN
  IF auth.role() = 'service_role' OR public.is_platform_admin() THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_identifier IS NULL OR p_identifier !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN public.business_status(public.get_owner_uid(auth.uid())) <> 'suspended';
  END IF;
  v_identifier := p_identifier::uuid;
  v_row_owner := public.get_owner_uid(v_identifier);
  v_caller_owner := public.get_owner_uid(auth.uid());
  RETURN v_row_owner = v_caller_owner AND public.business_status(v_row_owner) <> 'suspended';
END;
$$;

CREATE OR REPLACE FUNCTION public.suspension_storage_read_allowed(p_owner_id text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row_owner uuid;
  v_path_owner uuid;
  v_business_owner uuid;
BEGIN
  IF auth.role() = 'service_role' OR public.is_platform_admin() THEN RETURN true; END IF;
  IF p_owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_row_owner := public.get_owner_uid(p_owner_id::uuid);
  END IF;
  IF split_part(COALESCE(p_name, ''), '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_path_owner := public.get_owner_uid(split_part(p_name, '/', 1)::uuid);
  END IF;
  IF v_row_owner IS NOT NULL AND v_path_owner IS NOT NULL AND v_row_owner <> v_path_owner THEN RETURN false; END IF;
  v_business_owner := COALESCE(v_row_owner, v_path_owner);
  IF v_business_owner IS NULL THEN RETURN true; END IF;
  IF public.business_status(v_business_owner) = 'suspended' THEN RETURN false; END IF;
  IF auth.role() = 'anon' THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN v_business_owner = public.get_owner_uid(auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.suspension_public_catalog_business_active(p_owner_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.business_status(p_owner_uid) <> 'suspended'
$$;

REVOKE ALL ON FUNCTION public.suspension_business_read_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suspension_business_read_allowed(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.suspension_storage_read_allowed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suspension_storage_read_allowed(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.suspension_public_catalog_business_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suspension_public_catalog_business_active(uuid) TO anon, authenticated;

-- Reapply the suspension write trigger to every currently-owned table. Newer
-- tables may have been created after the original write-guard migration.
DO $$
DECLARE
  v_table record;
  v_arguments text;
BEGIN
  FOR v_table IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('user_id', 'owner_uid')
      AND t.table_type = 'BASE TABLE'
    GROUP BY c.table_schema, c.table_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tr
      JOIN pg_class cls ON cls.oid = tr.tgrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = v_table.table_schema AND cls.relname = v_table.table_name
        AND tr.tgname = 'suspension_write_guard' AND NOT tr.tgisinternal
    ) THEN
      SELECT string_agg(format('%L', c.column_name), ', ' ORDER BY CASE c.column_name WHEN 'user_id' THEN 1 ELSE 2 END)
        INTO v_arguments
      FROM information_schema.columns c
      WHERE c.table_schema = v_table.table_schema AND c.table_name = v_table.table_name
        AND c.column_name IN ('user_id', 'owner_uid');
      EXECUTE format(
        'CREATE TRIGGER suspension_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_suspended_business_writes(%s)',
        v_table.table_schema, v_table.table_name, v_arguments
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table record;
  v_identifier text;
BEGIN
  FOR v_table IN
    SELECT cls.oid::regclass AS table_ref, cls.relname AS table_name,
      bool_or(c.column_name = 'user_id') AS has_user_id,
      bool_or(c.column_name = 'owner_uid') AS has_owner_uid
    FROM information_schema.columns c
    JOIN pg_class cls ON cls.relname = c.table_name
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = c.table_schema
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('user_id', 'owner_uid') AND cls.relrowsecurity
    GROUP BY cls.oid, cls.relname
  LOOP
    v_identifier := CASE
      WHEN v_table.has_user_id AND v_table.has_owner_uid THEN 'COALESCE(owner_uid::text, user_id::text)'
      WHEN v_table.has_user_id THEN 'user_id::text'
      ELSE 'owner_uid::text'
    END;
    EXECUTE format(
      'CREATE POLICY suspension_read_guard ON %s AS RESTRICTIVE FOR SELECT TO authenticated USING (public.suspension_business_read_allowed(%s))',
      v_table.table_ref, v_identifier
    );
  END LOOP;
END;
$$;

CREATE POLICY suspension_profiles_read_guard ON public.profiles
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.suspension_business_read_allowed(id::text));
CREATE POLICY suspension_storage_read_guard ON storage.objects
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (public.suspension_storage_read_allowed(owner_id, name));
CREATE POLICY suspension_catalog_config_public_guard ON public.catalog_config
  AS RESTRICTIVE FOR SELECT TO anon
  USING (public.suspension_public_catalog_business_active(user_id));
CREATE POLICY suspension_products_public_guard ON public.products
  AS RESTRICTIVE FOR SELECT TO anon
  USING (public.suspension_public_catalog_business_active(user_id));
CREATE POLICY suspension_categories_public_guard ON public.categories
  AS RESTRICTIVE FOR SELECT TO anon
  USING (public.suspension_public_catalog_business_active(user_id));

CREATE OR REPLACE FUNCTION public.my_business_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_owner := public.get_owner_uid(v_uid);
  v_code := COALESCE((SELECT plan_code FROM public.business_subscriptions WHERE owner_uid = v_owner), 'base');
  RETURN jsonb_build_object(
    'plan_code', v_code,
    'plan_name', (SELECT name FROM public.business_plans WHERE code = v_code),
    'status', public.business_status(v_owner),
    'suspension_scheduled_for', (SELECT suspension_scheduled_for FROM public.business_subscriptions WHERE owner_uid = v_owner),
    'limits', public.business_limits(v_owner)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_schedule_business_suspension(p_owner_uid uuid, p_scheduled_for timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_plan text;
  v_existing timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF auth.uid() = p_owner_uid OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid) THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  SELECT status, plan_code, suspension_scheduled_for INTO v_status, v_plan, v_existing
    FROM public.business_subscriptions WHERE owner_uid = p_owner_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  IF v_plan = 'interno' THEN RAISE EXCEPTION 'platform-business-protected'; END IF;
  IF v_status = 'suspended' THEN RAISE EXCEPTION 'platform-business-already-suspended'; END IF;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'platform-business-suspension-already-scheduled'; END IF;
  IF p_scheduled_for IS NULL OR p_scheduled_for < now() + interval '1 minute' OR p_scheduled_for > now() + interval '90 days' THEN
    RAISE EXCEPTION 'platform-business-suspension-date-invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;

  UPDATE public.business_subscriptions
    SET suspension_previous_status = status,
        suspension_scheduled_for = p_scheduled_for,
        suspension_notice_sent_at = NULL,
        suspension_notice_error = NULL,
        updated_at = now()
    WHERE owner_uid = p_owner_uid;
  RETURN p_scheduled_for;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_cancel_business_suspension(p_owner_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF p_owner_uid = auth.uid() OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (SELECT 1 FROM public.business_subscriptions WHERE owner_uid = p_owner_uid AND plan_code = 'interno') THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;
  UPDATE public.business_subscriptions
    SET suspension_scheduled_for = NULL, suspension_previous_status = NULL,
        suspension_notice_sent_at = NULL, suspension_notice_error = NULL, updated_at = now()
    WHERE owner_uid = p_owner_uid AND status <> 'suspended' AND suspension_scheduled_for > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-suspension-not-pending'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_reactivate_business(p_owner_uid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF p_owner_uid = auth.uid() OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (SELECT 1 FROM public.business_subscriptions WHERE owner_uid = p_owner_uid AND plan_code = 'interno') THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;
  UPDATE public.business_subscriptions
    SET status = COALESCE(suspension_previous_status, 'active'),
        suspension_scheduled_for = NULL, suspension_previous_status = NULL,
        suspension_notice_sent_at = NULL, suspension_notice_error = NULL, updated_at = now()
    WHERE owner_uid = p_owner_uid AND (status = 'suspended' OR suspension_scheduled_for IS NOT NULL)
    RETURNING status INTO v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-suspension-not-pending'; END IF;
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_apply_due_business_suspensions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- pg_cron runs as the job owner without an Auth JWT; only the owning role and
  -- service_role can execute this function because the public grants are revoked below.
  UPDATE public.business_subscriptions
    SET status = 'suspended', updated_at = now()
    WHERE suspension_scheduled_for <= now() AND status <> 'suspended';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_schedule_business_suspension(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_cancel_business_suspension(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_reactivate_business(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_apply_due_business_suspensions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_schedule_business_suspension(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_cancel_business_suspension(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_reactivate_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_apply_due_business_suspensions() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-business-suspension-deadline') THEN
      PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'platform-business-suspension-deadline'));
    END IF;
    PERFORM cron.schedule('platform-business-suspension-deadline', '* * * * *',
      'SELECT public.platform_apply_due_business_suspensions()');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_catalog_products(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id, 'name', p.name, 'categoryId', p.category_id, 'category', p.category,
      'salePrice', round(GREATEST(p.sale_price, 0)), 'stock', p.stock, 'imageUrl', p.image_url,
      'images', COALESCE(to_jsonb(p.images), '[]'::jsonb), 'description', p.description,
      'availability', CASE WHEN p.custom_fields->>'rivaCatalogSupplierImport' = 'true' THEN 'on_order'
        WHEN p.stock > 0 THEN 'in_stock' ELSE 'out_of_stock' END,
      'createdAt', p.created_at
    ) ORDER BY p.created_at, p.name
  ), '[]'::jsonb)
  FROM public.catalog_config cc
  JOIN public.products p ON p.user_id = cc.user_id
  WHERE cc.slug = btrim(p_slug) AND cc.enabled AND public.business_status(cc.user_id) <> 'suspended'
    AND p.show_in_catalog
    AND (NOT p.catalog_only OR p.custom_fields->>'rivaCatalogSupplierImport' = 'true')
    AND (cc.show_out_of_stock OR p.stock > 0 OR p.custom_fields->>'rivaCatalogSupplierImport' = 'true');
$$;

CREATE OR REPLACE FUNCTION public.get_public_catalog_product(p_slug text, p_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'categoryId', p.category_id, 'category', p.category,
    'salePrice', round(GREATEST(p.sale_price, 0)), 'stock', p.stock, 'imageUrl', p.image_url,
    'images', COALESCE(to_jsonb(p.images), '[]'::jsonb), 'description', p.description,
    'availability', CASE WHEN p.custom_fields->>'rivaCatalogSupplierImport' = 'true' THEN 'on_order'
      WHEN p.stock > 0 THEN 'in_stock' ELSE 'out_of_stock' END,
    'createdAt', p.created_at
  )
  FROM public.catalog_config cc
  JOIN public.products p ON p.user_id = cc.user_id
  WHERE cc.slug = btrim(p_slug) AND cc.enabled AND public.business_status(cc.user_id) <> 'suspended'
    AND p.id = p_product_id AND p.show_in_catalog
    AND (NOT p.catalog_only OR p.custom_fields->>'rivaCatalogSupplierImport' = 'true')
    AND (cc.show_out_of_stock OR p.stock > 0 OR p.custom_fields->>'rivaCatalogSupplierImport' = 'true')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_catalog_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_catalog_products(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_catalog_product(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_catalog_product(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

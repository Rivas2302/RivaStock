BEGIN;

CREATE OR REPLACE FUNCTION public.suspension_require_active_business(p_identifier text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_owner uuid;
BEGIN
  IF p_identifier IS NULL OR p_identifier !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN;
  END IF;

  v_uid := p_identifier::uuid;
  v_owner := public.get_owner_uid(v_uid);
  IF v_owner IS NOT NULL THEN
    PERFORM public.business_require_active(v_owner);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.suspension_require_active_business(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_suspended_business_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_role text := auth.role();
  v_row jsonb;
  v_column text;
BEGIN
  -- Authless database jobs and service-role workers must continue to operate;
  -- platform administrators also need to be able to resume a business.
  IF v_request_role IS NULL OR v_request_role = 'service_role' OR public.is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  FOR v_row IN
    SELECT row_value
    FROM (VALUES
      (CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END),
      (CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END)
    ) AS changed_rows(row_value)
    WHERE row_value IS NOT NULL
  LOOP
    FOREACH v_column IN ARRAY TG_ARGV LOOP
      PERFORM public.suspension_require_active_business(v_row ->> v_column);
    END LOOP;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_suspended_business_writes() FROM PUBLIC, anon, authenticated;

-- Install the same write guard on every current public base table whose owner
-- can be identified by user_id or owner_uid. Views are covered by their base
-- table triggers when they are updatable.
DO $$
DECLARE
  v_table record;
  v_arguments text;
BEGIN
  FOR v_table IN
    SELECT c.table_schema, c.table_name,
      array_agg(c.column_name ORDER BY CASE c.column_name WHEN 'user_id' THEN 1 ELSE 2 END) AS owner_columns
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('user_id', 'owner_uid')
      AND t.table_type = 'BASE TABLE'
    GROUP BY c.table_schema, c.table_name
  LOOP
    SELECT string_agg(format('%L', column_name), ', ' ORDER BY column_name)
      INTO v_arguments
    FROM unnest(v_table.owner_columns) AS owner_column(column_name);

    EXECUTE format('DROP TRIGGER IF EXISTS suspension_write_guard ON %I.%I', v_table.table_schema, v_table.table_name);
    EXECUTE format(
      'CREATE TRIGGER suspension_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_suspended_business_writes(%s)',
      v_table.table_schema, v_table.table_name, v_arguments
    );
  END LOOP;
END;
$$;

-- Profiles use id as the account key and need the same read-only behavior.
DROP TRIGGER IF EXISTS suspension_write_guard ON public.profiles;
CREATE TRIGGER suspension_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_suspended_business_writes('id');

CREATE OR REPLACE FUNCTION public.prevent_suspended_storage_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_role text := auth.role();
  v_row jsonb;
  v_identifier text;
BEGIN
  IF v_request_role IS NULL OR v_request_role = 'service_role' OR public.is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  FOR v_row IN
    SELECT row_value
    FROM (VALUES
      (CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END),
      (CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END)
    ) AS changed_rows(row_value)
    WHERE row_value IS NOT NULL
  LOOP
    FOR v_identifier IN
      SELECT DISTINCT candidate
      FROM unnest(ARRAY[
        NULLIF(v_row ->> 'owner_id', ''),
        NULLIF(v_row ->> 'owner', ''),
        NULLIF(split_part(COALESCE(v_row ->> 'name', ''), '/', 1), '')
      ]) AS candidates(candidate)
      WHERE candidate IS NOT NULL
    LOOP
      PERFORM public.suspension_require_active_business(v_identifier);
    END LOOP;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_suspended_storage_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS suspension_write_guard ON storage.objects;
CREATE TRIGGER suspension_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.prevent_suspended_storage_writes();

COMMIT;

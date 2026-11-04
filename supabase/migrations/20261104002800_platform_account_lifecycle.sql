BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE public.business_deletion_requests (
  owner_uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  previous_status text NOT NULL CHECK (previous_status IN ('trial', 'active', 'suspended')),
  cancelled_at timestamptz,
  purge_started_at timestamptz,
  purge_attempts integer NOT NULL DEFAULT 0,
  last_failure_code text CHECK (last_failure_code IS NULL OR last_failure_code IN ('storage_cleanup_failed', 'database_cleanup_failed', 'auth_delete_failed')),
  CHECK (scheduled_for > requested_at)
);
CREATE INDEX business_deletion_requests_due_idx
  ON public.business_deletion_requests (scheduled_for)
  WHERE cancelled_at IS NULL;
ALTER TABLE public.business_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_deletion_requests TO service_role;

CREATE TABLE public.business_deletion_cron_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.business_deletion_cron_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_deletion_cron_config FROM PUBLIC, anon, authenticated, service_role;

-- Tenant-owned tables with NO ACTION foreign keys would otherwise stop Auth
-- deletion before their profile can cascade. Convert only ownership columns.
DO $$
DECLARE
  v_fk record;
BEGIN
  FOR v_fk IN
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public' AND ccu.table_name = 'profiles'
      AND kcu.column_name IN ('user_id', 'owner_uid')
      AND rc.delete_rule IN ('NO ACTION', 'RESTRICT')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_fk.table_name, v_fk.constraint_name);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE CASCADE',
      v_fk.table_name, v_fk.constraint_name, v_fk.column_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_business_export_manifest(p_owner_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_ids uuid[];
  v_business_name text;
  v_tables jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform-admin-required';
  END IF;

  SELECT business_name INTO v_business_name FROM public.profiles WHERE id = p_owner_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  v_owner_ids := ARRAY[p_owner_uid];

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', tables.table_name,
    'has_user_id', tables.has_user_id,
    'has_owner_uid', tables.has_owner_uid,
    'has_id', tables.has_id
  ) ORDER BY tables.table_name), '[]'::jsonb)
  INTO v_tables
  FROM (
    SELECT c.table_name,
      bool_or(c.column_name = 'user_id') AS has_user_id,
      bool_or(c.column_name = 'owner_uid') AS has_owner_uid,
      bool_or(c.column_name = 'id') AS has_id
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND (c.column_name IN ('user_id', 'owner_uid') OR c.table_name = 'profiles' AND c.column_name = 'id')
    GROUP BY c.table_name
    HAVING bool_or(c.column_name IN ('user_id', 'owner_uid')) OR c.table_name = 'profiles'
  ) tables;

  RETURN jsonb_build_object(
    'business_name', v_business_name,
    'owner_user_ids', to_jsonb(v_owner_ids),
    'tables', v_tables
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_export_business_table(
  p_owner_uid uuid,
  p_table_name text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_ids uuid[];
  v_predicates text[] := ARRAY[]::text[];
  v_predicate text;
  v_rows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform-admin-required';
  END IF;
  IF p_table_name IS NULL OR p_table_name !~ '^[a-z][a-z0-9_]{0,62}$'
    OR p_offset < 0 OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'platform-export-parameters-invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table_name AND table_type = 'BASE TABLE'
  ) THEN RAISE EXCEPTION 'platform-export-table-invalid'; END IF;

  v_owner_ids := ARRAY[p_owner_uid];
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner_uid) THEN
    RAISE EXCEPTION 'platform-business-not-found';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=p_table_name AND column_name='user_id') THEN
    v_predicates := array_append(v_predicates, 'exported.user_id::text = ANY($1::text[])');
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=p_table_name AND column_name='owner_uid') THEN
    v_predicates := array_append(v_predicates, 'exported.owner_uid::text = ANY($1::text[])');
  END IF;
  IF p_table_name = 'profiles' THEN
    v_predicates := array_append(v_predicates, 'exported.id::text = ANY($1::text[])');
  END IF;
  IF cardinality(v_predicates) = 0 THEN RAISE EXCEPTION 'platform-export-table-invalid'; END IF;
  v_predicate := array_to_string(v_predicates, ' OR ');

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(page_row)), ''[]''::jsonb) FROM (
       SELECT exported.* FROM public.%I AS exported WHERE (%s)
       ORDER BY to_jsonb(exported)::text LIMIT $2 OFFSET $3
     ) AS page_row',
    p_table_name, v_predicate
  ) INTO v_rows USING ARRAY(SELECT uid::text FROM unnest(v_owner_ids) AS uid), p_limit, p_offset;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_business_storage_inventory(
  p_owner_uid uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(bucket_id text, object_name text, object_size bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform-admin-required';
  END IF;
  IF p_offset < 0 OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'platform-storage-inventory-parameters-invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner_uid) THEN
    RAISE EXCEPTION 'platform-business-not-found';
  END IF;
  RETURN QUERY
    SELECT o.bucket_id, o.name,
      CASE WHEN o.metadata ->> 'size' ~ '^[0-9]+$' THEN (o.metadata ->> 'size')::bigint ELSE NULL END
    FROM storage.objects o
    WHERE o.name LIKE p_owner_uid::text || '/%'
       OR o.owner_id = p_owner_uid::text
    ORDER BY o.bucket_id, o.name
    LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_request_business_deletion(
  p_owner_uid uuid,
  p_confirmed_business_name text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_plan_code text;
  v_status text;
  v_scheduled_for timestamptz := now() + interval '30 days';
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  SELECT business_name INTO v_name FROM public.profiles WHERE id = p_owner_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  SELECT plan_code, status INTO v_plan_code, v_status
    FROM public.business_subscriptions WHERE owner_uid = p_owner_uid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid) OR v_plan_code = 'interno' THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF btrim(COALESCE(p_confirmed_business_name, '')) IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'platform-business-name-confirmation-mismatch';
  END IF;
  IF v_status IS NULL THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;

  INSERT INTO public.business_deletion_requests(owner_uid, requested_by, scheduled_for, previous_status)
    VALUES (p_owner_uid, auth.uid(), v_scheduled_for, v_status)
    ON CONFLICT (owner_uid) DO UPDATE SET
      requested_by = EXCLUDED.requested_by,
      requested_at = now(),
      scheduled_for = EXCLUDED.scheduled_for,
      previous_status = EXCLUDED.previous_status,
      cancelled_at = NULL,
      purge_started_at = NULL,
      purge_attempts = 0,
      last_failure_code = NULL
    WHERE business_deletion_requests.cancelled_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-deletion-already-pending'; END IF;

  UPDATE public.business_subscriptions SET status = 'suspended', updated_at = now()
    WHERE owner_uid = p_owner_uid;
  RETURN v_scheduled_for;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_cancel_business_deletion(p_owner_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.business_deletion_requests%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  SELECT * INTO v_request FROM public.business_deletion_requests
    WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-deletion-not-pending'; END IF;
  IF v_request.purge_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'platform-business-deletion-already-started';
  END IF;

  UPDATE public.business_deletion_requests SET cancelled_at = now(), purge_started_at = NULL
    WHERE owner_uid = p_owner_uid;
  UPDATE public.business_subscriptions SET status = v_request.previous_status, updated_at = now()
    WHERE owner_uid = p_owner_uid;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_claim_due_business_deletions(p_limit integer DEFAULT 5)
RETURNS TABLE(owner_uid uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service-role-required'; END IF;
  IF p_limit < 1 OR p_limit > 20 THEN RAISE EXCEPTION 'platform-purge-limit-invalid'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT request.owner_uid
    FROM public.business_deletion_requests request
    WHERE request.cancelled_at IS NULL
      AND request.scheduled_for <= now()
      AND (request.purge_started_at IS NULL OR request.purge_started_at < now() - interval '30 minutes')
    ORDER BY request.scheduled_for
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.business_deletion_requests request
  SET purge_started_at = now(), purge_attempts = request.purge_attempts + 1
  FROM due
  WHERE request.owner_uid = due.owner_uid
  RETURNING request.owner_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_record_business_purge_failure(p_owner_uid uuid, p_failure_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service-role-required'; END IF;
  IF p_failure_code NOT IN ('storage_cleanup_failed', 'database_cleanup_failed', 'auth_delete_failed') THEN
    RAISE EXCEPTION 'platform-purge-failure-code-invalid';
  END IF;
  UPDATE public.business_deletion_requests
    SET purge_started_at = NULL, last_failure_code = p_failure_code
    WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_purge_business_rows(p_owner_uid uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table record;
  v_predicates text[];
  v_deleted bigint;
  v_total bigint := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service-role-required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_deletion_requests
    WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL AND purge_started_at IS NOT NULL AND scheduled_for <= now()
  ) THEN RAISE EXCEPTION 'platform-business-deletion-not-claimed'; END IF;

  FOR v_table IN
    SELECT c.table_name, array_agg(DISTINCT c.column_name ORDER BY c.column_name) AS owner_columns
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('user_id', 'owner_uid')
      AND c.table_name NOT IN ('business_deletion_requests', 'business_deletion_cron_config', 'business_subscriptions', 'platform_admins')
    GROUP BY c.table_name
  LOOP
    SELECT array_agg(format('%I::text = $1', owner_column)) INTO v_predicates
    FROM unnest(v_table.owner_columns) AS owner_column;
    EXECUTE format('DELETE FROM public.%I WHERE %s', v_table.table_name, array_to_string(v_predicates, ' OR '))
      USING p_owner_uid::text;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total := v_total + v_deleted;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_validate_business_purge_token(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.role() = 'service_role'
    AND p_token IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.business_deletion_cron_config
      WHERE id AND token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    )
$$;

REVOKE ALL ON FUNCTION public.platform_business_export_manifest(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_export_business_table(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_business_storage_inventory(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_request_business_deletion(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_cancel_business_deletion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_claim_due_business_deletions(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_record_business_purge_failure(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_purge_business_rows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_validate_business_purge_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_business_export_manifest(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_export_business_table(uuid, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_business_storage_inventory(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.platform_request_business_deletion(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_cancel_business_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_claim_due_business_deletions(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_record_business_purge_failure(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_purge_business_rows(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_validate_business_purge_token(text) TO service_role;

DO $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'riva_business_deletion_cron_token') THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    PERFORM vault.create_secret(v_token, 'riva_business_deletion_cron_token', 'Invocación programada de la limpieza de cuentas RivaStock');
    INSERT INTO public.business_deletion_cron_config(id, token_sha256)
      VALUES (true, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
      ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;

-- The project URL is public metadata, stored in Vault for the cron command.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'riva_project_url') THEN
    PERFORM vault.create_secret('https://nkfqhuqrgrpfufdymkcr.supabase.co', 'riva_project_url', 'URL pública del proyecto para el proceso programado');
  END IF;
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'business-deletion-purge';
    IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
    PERFORM cron.schedule(
      'business-deletion-purge', '*/15 * * * *',
      $job$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'riva_project_url') || '/functions/v1/account-purge',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-riva-cron-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'riva_business_deletion_cron_token')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 10000
        ) AS request_id;
      $job$
    );
  END IF;
END;
$$;

COMMIT;

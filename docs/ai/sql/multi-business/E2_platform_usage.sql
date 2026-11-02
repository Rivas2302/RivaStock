-- E2 · Medición de uso por negocio y protección del proyecto (aditiva)
BEGIN;

CREATE TABLE public.platform_usage_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid            uuid REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = proyecto completo
  taken_at             timestamptz NOT NULL DEFAULT now(),
  db_bytes             bigint NOT NULL CHECK (db_bytes >= 0),
  storage_bytes        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(storage_bytes) = 'object'),
  storage_total_bytes  bigint NOT NULL CHECK (storage_total_bytes >= 0),
  local_knowledge_bytes bigint CHECK (local_knowledge_bytes >= 0)
);
CREATE INDEX platform_usage_snapshots_owner_idx ON public.platform_usage_snapshots (owner_uid, taken_at DESC);
CREATE INDEX platform_usage_snapshots_project_idx ON public.platform_usage_snapshots (taken_at DESC) WHERE owner_uid IS NULL;
ALTER TABLE public.platform_usage_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_usage_snapshots FROM anon, authenticated;

-- Estimación del peso en la base de un negocio: suma de pg_column_size de sus filas
-- en todas las tablas públicas con columna uuid user_id u owner_uid (sin índices).
CREATE FUNCTION public.platform_owner_db_bytes(p_owner uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_part bigint;
  v_total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('user_id', 'owner_uid')
      AND c.data_type = 'uuid'
      AND c.table_name NOT IN ('platform_usage_snapshots', 'business_subscriptions', 'platform_admins')
  LOOP
    EXECUTE format('SELECT COALESCE(sum(pg_column_size(x.*)), 0) FROM public.%I x WHERE x.%I = $1',
                   r.table_name, r.column_name)
      INTO v_part USING p_owner;
    v_total := v_total + v_part;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE FUNCTION public.platform_storage_by_bucket(p_owner uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT COALESCE(jsonb_object_agg(bucket_id, bytes), '{}'::jsonb)
  FROM (
    SELECT o.bucket_id, sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$'
                                 THEN (o.metadata->>'size')::bigint ELSE 0 END) AS bytes
    FROM storage.objects o
    WHERE p_owner IS NULL OR split_part(o.name, '/', 1) = p_owner::text
    GROUP BY o.bucket_id
  ) s
$$;

CREATE FUNCTION public.platform_storage_total_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT COALESCE(sum(CASE WHEN metadata->>'size' ~ '^[0-9]{1,15}$'
                           THEN (metadata->>'size')::bigint ELSE 0 END), 0)::bigint
  FROM storage.objects
$$;

-- ¿Entra una subida nueva en la nube sin pasar el presupuesto del proyecto?
CREATE FUNCTION public.platform_cloud_upload_allowed(p_bytes bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT platform_storage_total_bytes() + GREATEST(COALESCE(p_bytes, 0), 0)
         <= (SELECT storage_budget_bytes FROM platform_settings WHERE id)
$$;

CREATE FUNCTION public.platform_collect_usage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_storage jsonb;
  v_count integer := 0;
BEGIN
  FOR v_owner IN SELECT o FROM business_owner_ids() o LOOP
    v_storage := platform_storage_by_bucket(v_owner);
    INSERT INTO platform_usage_snapshots (owner_uid, db_bytes, storage_bytes, storage_total_bytes, local_knowledge_bytes)
    VALUES (
      v_owner,
      platform_owner_db_bytes(v_owner),
      v_storage,
      COALESCE((SELECT sum(value::bigint) FROM jsonb_each_text(v_storage)), 0),
      NULL -- E4 lo completa con lo que informa la central
    );
    v_count := v_count + 1;
  END LOOP;

  v_storage := platform_storage_by_bucket(NULL);
  INSERT INTO platform_usage_snapshots (owner_uid, db_bytes, storage_bytes, storage_total_bytes)
  VALUES (NULL, pg_database_size(current_database()), v_storage,
          COALESCE((SELECT sum(value::bigint) FROM jsonb_each_text(v_storage)), 0));

  DELETE FROM platform_usage_snapshots WHERE taken_at < now() - interval '90 days';
  RETURN v_count;
END;
$$;

-- Chequeo previo para subidas directas a Storage (fotos de productos, comprobantes).
CREATE FUNCTION public.storage_upload_check(p_bucket text, p_bytes bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_owner := get_owner_uid(v_uid);
  IF p_bucket IS NULL OR p_bucket NOT IN ('assets', 'supplier-order-documents') THEN
    RAISE EXCEPTION 'Bucket no permitido';
  END IF;
  IF business_status(v_owner) = 'suspended' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'suspended');
  END IF;
  IF NOT platform_cloud_upload_allowed(p_bytes) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'project_storage_full');
  END IF;
  RETURN jsonb_build_object('allowed', true);
END;
$$;

CREATE FUNCTION public.platform_usage_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project platform_usage_snapshots%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
BEGIN
  PERFORM platform_require_admin();
  SELECT * INTO v_settings FROM platform_settings WHERE id;
  SELECT * INTO v_project FROM platform_usage_snapshots WHERE owner_uid IS NULL ORDER BY taken_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'budgets', jsonb_build_object('db_bytes', v_settings.db_budget_bytes,
                                  'storage_bytes', v_settings.storage_budget_bytes,
                                  'warn_ratio', v_settings.warn_ratio),
    'live', jsonb_build_object('db_bytes', pg_database_size(current_database()),
                               'storage_bytes', platform_storage_total_bytes()),
    'last_snapshot_at', v_project.taken_at,
    'businesses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'owner_uid', o,
        'business_name', p.business_name,
        'email', p.email,
        'created_at', p.created_at,
        'plan_code', COALESCE(s.plan_code, 'base'),
        'status', COALESCE(s.status, 'active'),
        'db_bytes', u.db_bytes,
        'storage_bytes', u.storage_bytes,
        'storage_total_bytes', u.storage_total_bytes,
        'local_knowledge_bytes', u.local_knowledge_bytes,
        'central_last_seen_at', (SELECT max(d.last_seen_at) FROM ai_bridge_devices d
                                 WHERE d.user_id = o AND d.revoked_at IS NULL)
      ) ORDER BY p.created_at)
      FROM business_owner_ids() o
      JOIN profiles p ON p.id = o
      LEFT JOIN business_subscriptions s ON s.owner_uid = o
      LEFT JOIN LATERAL (
        SELECT * FROM platform_usage_snapshots x WHERE x.owner_uid = o ORDER BY x.taken_at DESC LIMIT 1
      ) u ON true
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_owner_db_bytes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_storage_by_bucket(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_storage_total_bytes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_cloud_upload_allowed(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_collect_usage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_upload_check(text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_usage_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_upload_check(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_usage_overview() TO authenticated;

-- Fotos de productos: ya se suben como WebP de hasta 1600 px; el bucket no tenía tope por archivo.
UPDATE storage.buckets SET file_size_limit = 2097152 WHERE id = 'assets' AND file_size_limit IS NULL;

COMMIT;

-- Programación diaria (fuera de la transacción, mismo patrón que 0071):
-- SELECT cron.schedule('platform-usage-daily', '17 6 * * *', 'SELECT public.platform_collect_usage()');

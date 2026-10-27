BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('automation-traces', 'automation-traces', false, 1048576, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The Edge Function uses the same token digest stored for facebook_worker_v2.
-- Keep token verification and owner/device resolution inside Postgres.
CREATE OR REPLACE FUNCTION public.facebook_trace_authorize_device(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_identity jsonb;
BEGIN
  IF p_token IS NULL OR char_length(p_token) NOT BETWEEN 32 AND 256 THEN
    RETURN NULL;
  END IF;

  -- Let the established worker RPC remain the source of truth for capability
  -- validation and revocation. This lookup only resolves its verified token
  -- to the owner/device IDs required by the trace RPCs.
  BEGIN
    PERFORM public.facebook_worker_v2(p_token, 'heartbeat', NULL, NULL, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IN ('Conexión vencida o revocada', 'Conexión sin permiso') THEN
      RETURN NULL;
    END IF;
    RAISE;
  END;

  SELECT jsonb_build_object('owner_uid', device.user_id, 'device_id', device.id)
  INTO v_identity
  FROM public.facebook_devices AS device
  JOIN public.facebook_device_secrets AS secret ON secret.device_id = device.id
  WHERE device.revoked_at IS NULL
    AND secret.token_expires_at > now()
    AND secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    AND public.has_permission(device.user_id, 'config', 'write')
  LIMIT 1;

  RETURN v_identity;
END;
$$;

REVOKE ALL ON FUNCTION public.facebook_trace_authorize_device(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_trace_authorize_device(text) TO service_role;

CREATE TABLE public.fb_trace_storage_reservations (
  storage_path text PRIMARY KEY CHECK (char_length(storage_path) <= 500),
  trace_id uuid NOT NULL REFERENCES public.fb_run_traces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 600000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fb_trace_storage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fb_trace_storage_reservations FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fb_trace_storage_reserve(
  p_user_id uuid,
  p_trace_id uuid,
  p_storage_path text,
  p_file_size integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_used_bytes bigint;
  v_reserved_bytes bigint;
  v_inserted integer;
BEGIN
  IF p_user_id IS NULL OR p_trace_id IS NULL
    OR p_file_size IS NULL OR p_file_size NOT BETWEEN 1 AND 600000
    OR p_storage_path IS NULL
    OR p_storage_path !~ ('^' || p_user_id::text || '/' || p_trace_id::text || '/[1-9][0-9]{0,4}[.]jpg$')
    OR NOT EXISTS (
      SELECT 1 FROM public.fb_run_traces AS trace
      WHERE trace.id = p_trace_id
        AND trace.user_id = p_user_id
        AND trace.finished_at IS NULL
        AND trace.started_at >= now() - interval '14 days'
    ) THEN
    RAISE EXCEPTION 'Invalid trace storage reservation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 42017));

  SELECT COALESCE(sum(
    CASE WHEN object.metadata->>'size' ~ '^[0-9]{1,12}$'
      THEN (object.metadata->>'size')::bigint ELSE 0 END
  ), 0)
  INTO v_used_bytes
  FROM storage.objects AS object
  WHERE object.bucket_id = 'automation-traces'
    AND object.name LIKE p_user_id::text || '/%';

  SELECT COALESCE(sum(reservation.file_size), 0)
  INTO v_reserved_bytes
  FROM public.fb_trace_storage_reservations AS reservation
  WHERE reservation.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'automation-traces'
        AND object.name = reservation.storage_path
    );

  IF v_used_bytes + v_reserved_bytes + p_file_size > 150000000 THEN
    RETURN false;
  END IF;

  INSERT INTO public.fb_trace_storage_reservations(storage_path, trace_id, user_id, file_size)
  VALUES (p_storage_path, p_trace_id, p_user_id, p_file_size)
  ON CONFLICT (storage_path) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fb_trace_storage_release(p_user_id uuid, p_storage_path text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.fb_trace_storage_reservations
  WHERE user_id = p_user_id AND storage_path = p_storage_path;
$$;

REVOKE ALL ON FUNCTION public.fb_trace_storage_reserve(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_trace_storage_release(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fb_trace_storage_reserve(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_trace_storage_release(uuid, text) TO service_role;

-- Include reservations as well as completed steps so a worker restart during
-- upload cannot leave an untracked object behind after the 14-day retention.
CREATE OR REPLACE FUNCTION public.fb_traces_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_cleanup timestamptz;
  v_traces jsonb;
BEGIN
  SELECT state.last_cleanup_at INTO v_last_cleanup
  FROM public.fb_trace_cleanup_state AS state
  WHERE state.singleton = true
  FOR UPDATE;

  IF v_last_cleanup IS NOT NULL AND v_last_cleanup > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('due', false, 'traces', '[]'::jsonb);
  END IF;

  UPDATE public.fb_trace_cleanup_state
  SET last_cleanup_at = now()
  WHERE singleton = true;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'trace_id', expired.id,
        'screenshot_paths', COALESCE(paths.paths, '[]'::jsonb)
      ) ORDER BY expired.started_at
    ),
    '[]'::jsonb
  ) INTO v_traces
  FROM (
    SELECT trace.id, trace.started_at
    FROM public.fb_run_traces AS trace
    WHERE trace.started_at < now() - interval '14 days'
    ORDER BY trace.started_at
    LIMIT 500
  ) AS expired
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(DISTINCT path ORDER BY path) AS paths
    FROM (
      SELECT step.screenshot_path AS path
      FROM public.fb_trace_steps AS step
      WHERE step.trace_id = expired.id AND step.screenshot_path IS NOT NULL
      UNION ALL
      SELECT reservation.storage_path AS path
      FROM public.fb_trace_storage_reservations AS reservation
      WHERE reservation.trace_id = expired.id
    ) AS trace_paths
  ) AS paths;

  RETURN jsonb_build_object('due', true, 'traces', v_traces);
END;
$$;

COMMIT;

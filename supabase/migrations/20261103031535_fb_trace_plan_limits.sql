BEGIN;

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

  IF v_used_bytes + v_reserved_bytes + p_file_size > business_limit_bigint(p_user_id, 'trace_bytes')
    OR NOT platform_cloud_upload_allowed(p_file_size) THEN
    RETURN false;
  END IF;

  INSERT INTO public.fb_trace_storage_reservations(storage_path, trace_id, user_id, file_size)
  VALUES (p_storage_path, p_trace_id, p_user_id, p_file_size)
  ON CONFLICT (storage_path) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

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
        'screenshot_paths', COALESCE((
          SELECT jsonb_agg(step.screenshot_path ORDER BY step.seq)
          FROM public.fb_trace_steps AS step
          WHERE step.trace_id = expired.id AND step.screenshot_path IS NOT NULL
        ), '[]'::jsonb)
      )
      ORDER BY expired.started_at
    ),
    '[]'::jsonb
  ) INTO v_traces
  FROM (
    SELECT trace.id, trace.started_at
    FROM public.fb_run_traces AS trace
    WHERE trace.started_at < now() - make_interval(days =>
      LEAST(14, GREATEST(0, business_limit_bigint(trace.user_id, 'trace_retention_days')::integer)))
    ORDER BY trace.started_at
    LIMIT 500
  ) AS expired;

  RETURN jsonb_build_object('due', true, 'traces', v_traces);
END;
$$;

CREATE OR REPLACE FUNCTION public.fb_traces_cleanup_finalize(p_trace_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_trace_ids IS NULL OR cardinality(p_trace_ids) > 500 THEN
    RAISE EXCEPTION 'Invalid cleanup trace batch';
  END IF;

  DELETE FROM public.fb_run_traces AS trace
  WHERE trace.id = ANY(p_trace_ids)
    AND trace.started_at < now() - make_interval(days =>
      LEAST(14, GREATEST(0, business_limit_bigint(trace.user_id, 'trace_retention_days')::integer)));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.fb_trace_storage_reserve(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_traces_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_traces_cleanup_finalize(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fb_trace_storage_reserve(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_traces_cleanup() TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_traces_cleanup_finalize(uuid[]) TO service_role;

COMMIT;

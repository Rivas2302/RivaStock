BEGIN;

-- Keep the existing worker contract intact while adding an attempt-scoped,
-- append-only telemetry operation for post-submit observations.
ALTER FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb)
  RENAME TO fb_supervisor_worker_pre_post_submit;

CREATE FUNCTION public.fb_supervisor_record_post_submit(
  p_owner uuid,
  p_worker uuid,
  p_attempt uuid,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt record;
  v_observation jsonb;
  v_url jsonb;
  v_alert jsonb;
  v_index bigint;
  v_expected_offsets integer[] := ARRAY[0, 3000, 8000];
  v_trace_seq integer;
  v_existing jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF p_owner IS NULL OR p_worker IS NULL OR p_attempt IS NULL
    OR public.get_owner_uid(p_owner) IS DISTINCT FROM p_owner
    OR NOT EXISTS (
      SELECT 1 FROM public.ai_bridge_devices AS device
      WHERE device.id = p_worker AND device.user_id = p_owner AND device.revoked_at IS NULL
        AND device.last_seen_at > now() - interval '2 minutes'
    ) THEN
    RAISE EXCEPTION 'SUPERVISOR_WORKER_INVALID';
  END IF;
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object'
    OR p_data - 'post_submit_observations' <> '{}'::jsonb
    OR octet_length(p_data::text) > 8192
    OR jsonb_typeof(p_data->'post_submit_observations') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
  END IF;
  IF jsonb_array_length(p_data->'post_submit_observations') <> 3 THEN
    RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
  END IF;

  FOR v_observation, v_index IN
    SELECT value, ordinality FROM jsonb_array_elements(p_data->'post_submit_observations') WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_observation) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_observation)) <> 6
      OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v_observation) AS item(key)
        WHERE item.key NOT IN ('sample_offset_ms', 'elapsed_ms', 'capture_status', 'trace_seq', 'alerts', 'new_urls')
      )
      OR jsonb_typeof(v_observation->'sample_offset_ms') IS DISTINCT FROM 'number'
      OR v_observation->'sample_offset_ms' <> to_jsonb(v_expected_offsets[v_index::integer])
      OR jsonb_typeof(v_observation->'elapsed_ms') IS DISTINCT FROM 'number'
      OR coalesce(v_observation->>'elapsed_ms', '') !~ '^[0-9]{1,6}$'
      OR (v_observation->>'elapsed_ms')::integer NOT BETWEEN 0 AND 120000
      OR coalesce(v_observation->>'capture_status', '') NOT IN ('captured', 'unavailable') THEN
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;
    IF jsonb_typeof(v_observation->'alerts') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_observation->'new_urls') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;
    IF jsonb_array_length(v_observation->'alerts') > 3 OR jsonb_array_length(v_observation->'new_urls') > 5 THEN
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;

    IF jsonb_typeof(v_observation->'trace_seq') = 'null' THEN
      v_trace_seq := NULL;
    ELSIF jsonb_typeof(v_observation->'trace_seq') = 'number'
      AND coalesce(v_observation->>'trace_seq', '') ~ '^[0-9]{1,5}$' THEN
      v_trace_seq := (v_observation->>'trace_seq')::integer;
      IF v_trace_seq NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID'; END IF;
    ELSE
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;
    IF v_observation->>'capture_status' = 'captured' AND v_trace_seq IS NULL THEN
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;
    IF v_observation->>'capture_status' = 'unavailable' AND v_trace_seq IS NOT NULL THEN
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;

    FOR v_alert IN SELECT value FROM jsonb_array_elements(v_observation->'alerts')
    LOOP
      IF jsonb_typeof(v_alert) IS DISTINCT FROM 'string'
        OR char_length(v_alert #>> '{}') NOT BETWEEN 1 AND 160
        OR btrim(v_alert #>> '{}') = '' THEN
        RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
      END IF;
    END LOOP;

    FOR v_url IN SELECT value FROM jsonb_array_elements(v_observation->'new_urls')
    LOOP
      IF jsonb_typeof(v_url) IS DISTINCT FROM 'string'
        OR char_length(v_url #>> '{}') > 300
        OR (v_url #>> '{}') !~ '^https://([A-Za-z0-9-]+\.)*facebook\.com(/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*)?$' THEN
        RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
      END IF;
    END LOOP;

    IF (SELECT count(*) FROM jsonb_array_elements(v_observation->'new_urls'))
      <> (SELECT count(DISTINCT value) FROM jsonb_array_elements(v_observation->'new_urls')) THEN
      RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID';
    END IF;
  END LOOP;

  SELECT attempt.*, delivery.active_attempt_id, publication.user_id AS publication_owner,
      facebook_device.user_id AS device_owner, facebook_device.revoked_at AS device_revoked_at
    INTO v_attempt
  FROM public.facebook_delivery_attempts AS attempt
  JOIN public.facebook_deliveries AS delivery ON delivery.id = attempt.delivery_id
  JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
  JOIN public.facebook_devices AS facebook_device ON facebook_device.id = attempt.device_id
  WHERE attempt.id = p_attempt
  FOR UPDATE OF attempt, delivery;

  IF NOT FOUND THEN RAISE EXCEPTION 'POST_SUBMIT_ATTEMPT_INVALID'; END IF;
  IF v_attempt.publication_owner IS DISTINCT FROM p_owner
    OR v_attempt.device_owner IS DISTINCT FROM p_owner OR v_attempt.device_revoked_at IS NOT NULL
    OR v_attempt.authorized_at IS NULL
    OR (v_attempt.active_attempt_id IS DISTINCT FROM p_attempt AND v_attempt.finished_at IS NULL)
    OR v_attempt.started_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'POST_SUBMIT_ATTEMPT_INVALID';
  END IF;

  FOR v_observation, v_index IN
    SELECT value, ordinality FROM jsonb_array_elements(p_data->'post_submit_observations') WITH ORDINALITY
  LOOP
    IF v_observation->>'capture_status' = 'captured' THEN
      v_trace_seq := (v_observation->>'trace_seq')::integer;
      IF NOT EXISTS (
        SELECT 1 FROM public.fb_run_traces AS trace
        JOIN public.fb_trace_steps AS step ON step.trace_id = trace.id
        WHERE trace.attempt_id = p_attempt AND trace.user_id = p_owner
          AND trace.device_id = v_attempt.device_id AND step.seq = v_trace_seq
      ) THEN RAISE EXCEPTION 'POST_SUBMIT_TRACE_INVALID'; END IF;
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtextextended('fb-post-submit:' || p_attempt::text, 0));
  SELECT data INTO v_existing FROM public.facebook_delivery_attempt_events
  WHERE attempt_id = p_attempt AND idempotency_key = 'post-submit-observations-v1' FOR UPDATE;
  IF FOUND THEN
    IF v_existing IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_CONFLICT'; END IF;
    RETURN jsonb_build_object('saved', true, 'already_saved', true);
  END IF;

  PERFORM public.facebook_attempt_event(p_attempt, 'progress', p_data, 'post-submit-observations-v1');
  RETURN jsonb_build_object('saved', true, 'already_saved', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fb_supervisor_record_post_submit(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fb_supervisor_worker(
  p_owner uuid,
  p_worker uuid,
  p_operation text,
  p_id uuid DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_operation = 'post_submit_observations' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'POST_SUBMIT_OBSERVATIONS_INVALID'; END IF;
    RETURN public.fb_supervisor_record_post_submit(p_owner, p_worker, p_id, p_data);
  END IF;
  RETURN public.fb_supervisor_worker_pre_post_submit(p_owner, p_worker, p_operation, p_id, p_data);
END;
$$;

REVOKE ALL ON FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb) TO service_role;

COMMIT;

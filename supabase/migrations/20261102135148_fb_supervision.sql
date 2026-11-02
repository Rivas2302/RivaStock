BEGIN;

CREATE FUNCTION public.fb_supervision_hint_match_valid(p_match jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF jsonb_typeof(p_match) IS DISTINCT FROM 'object'
    OR octet_length(p_match::text) > 2048
    OR jsonb_typeof(p_match->'role') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_match->>'role')) NOT BETWEEN 1 AND 32 THEN
    RETURN false;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_match) LOOP
    IF v_key NOT IN ('role', 'accessible_name', 'text', 'nearby_heading') THEN RETURN false; END IF;
    v_value := p_match->v_key;
    IF jsonb_typeof(v_value) IS DISTINCT FROM 'string'
      OR (v_key = 'role' AND char_length(v_value #>> '{}') > 32)
      OR (v_key = 'accessible_name' AND char_length(v_value #>> '{}') > 160)
      OR (v_key = 'text' AND char_length(v_value #>> '{}') > 200)
      OR (v_key = 'nearby_heading' AND char_length(v_value #>> '{}') > 160) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN (char_length(btrim(coalesce(p_match->>'accessible_name', ''))) > 0
      OR char_length(btrim(coalesce(p_match->>'text', ''))) > 0)
    AND (p_match ? 'accessible_name' OR p_match ? 'text');
END;
$$;

CREATE TABLE public.fb_supervision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trace_id uuid NOT NULL REFERENCES public.fb_run_traces(id) ON DELETE CASCADE,
  step_seq integer NOT NULL CHECK (step_seq BETWEEN 1 AND 10000),
  kind text NOT NULL CHECK (kind IN ('recover_step', 'verify_result', 'review_content', 'review_photos')),
  intent jsonb NOT NULL CHECK (
    jsonb_typeof(intent) IS NOT DISTINCT FROM 'object' AND octet_length(intent::text) <= 8192
    AND jsonb_typeof(intent->'step') IS NOT DISTINCT FROM 'string'
    AND char_length(btrim(intent->>'step')) BETWEEN 1 AND 160
    AND jsonb_typeof(intent->'intent_key') IS NOT DISTINCT FROM 'string'
    AND char_length(btrim(intent->>'intent_key')) BETWEEN 1 AND 240
  ),
  dom_summary jsonb NOT NULL CHECK (
    jsonb_typeof(dom_summary) IS NOT DISTINCT FROM 'object' AND octet_length(dom_summary::text) <= 20480
    AND jsonb_typeof(dom_summary->'controls') IS NOT DISTINCT FROM 'array'
    AND jsonb_array_length(dom_summary->'controls') <= 80
  ),
  screenshot_path text CHECK (screenshot_path IS NULL OR char_length(screenshot_path) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'answered', 'failed', 'expired')),
  decision jsonb CHECK (decision IS NULL OR (jsonb_typeof(decision) = 'object' AND octet_length(decision::text) <= 4096)),
  provider text CHECK (provider IS NULL OR provider IN ('codex', 'claude')),
  model_id text CHECK (model_id IS NULL OR char_length(model_id) BETWEEN 1 AND 80),
  reasoning_effort text CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high', 'xhigh')),
  worker_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  outcome_success boolean,
  outcome_reported_at timestamptz,
  CONSTRAINT fb_supervision_requests_processing_lease CHECK (
    (status = 'processing' AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND worker_id IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT fb_supervision_requests_answer_pair CHECK (
    (status = 'answered' AND decision IS NOT NULL AND provider IS NOT NULL AND model_id IS NOT NULL
      AND reasoning_effort IS NOT NULL AND answered_at IS NOT NULL)
    OR (status <> 'answered' AND decision IS NULL AND provider IS NULL AND model_id IS NULL
      AND reasoning_effort IS NULL AND answered_at IS NULL)
  ),
  CONSTRAINT fb_supervision_requests_outcome_pair CHECK (
    (outcome_success IS NULL) = (outcome_reported_at IS NULL)
  )
);

CREATE INDEX fb_supervision_requests_reservation_idx
  ON public.fb_supervision_requests (user_id, status, created_at);
CREATE INDEX fb_supervision_requests_trace_step_idx
  ON public.fb_supervision_requests (trace_id, step_seq, created_at DESC);
CREATE INDEX fb_supervision_requests_worker_lease_idx
  ON public.fb_supervision_requests (worker_id, lease_expires_at)
  WHERE status = 'processing';

CREATE TABLE public.fb_learned_hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (char_length(btrim(step)) BETWEEN 1 AND 160),
  intent_key text NOT NULL CHECK (char_length(btrim(intent_key)) BETWEEN 1 AND 240),
  match jsonb NOT NULL CHECK (jsonb_typeof(match) = 'object' AND octet_length(match::text) <= 2048),
  success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_used_at timestamptz,
  source_request_id uuid REFERENCES public.fb_supervision_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fb_learned_hints_match_shape CHECK (public.fb_supervision_hint_match_valid(match)),
  CONSTRAINT fb_learned_hints_unique_match UNIQUE (user_id, step, intent_key, match)
);

CREATE INDEX fb_learned_hints_lookup_idx
  ON public.fb_learned_hints (user_id, step, intent_key, success_count DESC, last_used_at DESC)
  WHERE success_count - failure_count >= 1;
CREATE INDEX fb_learned_hints_source_request_idx
  ON public.fb_learned_hints (source_request_id)
  WHERE source_request_id IS NOT NULL;

ALTER TABLE public.fb_supervision_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_learned_hints ENABLE ROW LEVEL SECURITY;

CREATE POLICY fb_supervision_requests_owner_read
  ON public.fb_supervision_requests FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND user_id = (SELECT public.knowledge_owner_for('read'))
  );

REVOKE ALL ON TABLE public.fb_supervision_requests, public.fb_learned_hints
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fb_supervision_requests TO authenticated;

CREATE FUNCTION public.fb_supervision_decision_valid(p_decision jsonb, p_dom_summary jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_action text;
  v_index integer;
  v_control jsonb;
  v_number numeric;
BEGIN
  IF jsonb_typeof(p_decision) IS DISTINCT FROM 'object'
    OR octet_length(p_decision::text) > 4096
    OR jsonb_typeof(p_dom_summary) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_dom_summary->'controls') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_decision->'action') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_decision->'confidence') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_decision->'observation') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_decision->'reason') IS DISTINCT FROM 'string'
    OR char_length(p_decision->>'observation') > 300
    OR char_length(p_decision->>'reason') > 300 THEN
    RETURN false;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_decision) LOOP
    IF v_key NOT IN ('action', 'element_index', 'text', 'wait_ms', 'confidence', 'observation', 'reason') THEN
      RETURN false;
    END IF;
  END LOOP;

  v_action := p_decision->>'action';
  IF v_action NOT IN ('click', 'type', 'select_option', 'scroll_container', 'wait', 'reload', 'skip_destination', 'abort') THEN
    RETURN false;
  END IF;
  v_number := (p_decision->>'confidence')::numeric;
  IF v_number < 0.6 OR v_number > 1 THEN RETURN false; END IF;

  IF v_action IN ('click', 'type', 'select_option', 'scroll_container') THEN
    IF jsonb_typeof(p_decision->'element_index') IS DISTINCT FROM 'number'
      OR p_decision->>'element_index' !~ '^(0|[1-9][0-9]?)$' THEN
      RETURN false;
    END IF;
    v_index := (p_decision->>'element_index')::integer;
    IF v_index < 0 OR v_index > 79 THEN RETURN false; END IF;

    SELECT control INTO v_control
    FROM jsonb_array_elements(p_dom_summary->'controls') AS item(control)
    WHERE item.control->>'index' = v_index::text
    LIMIT 1;
    IF v_control IS NULL
      OR coalesce(v_control->'state'->>'disabled', 'false') = 'true' THEN
      RETURN false;
    END IF;
    IF v_action = 'click' AND lower(btrim(coalesce(v_control->>'name', ''))) ~ '^(publicar|compartir ahora|publish|share now)$' THEN
      RETURN false;
    END IF;
  ELSIF p_decision ? 'element_index' THEN
    RETURN false;
  END IF;

  IF v_action IN ('type', 'select_option') THEN
    IF jsonb_typeof(p_decision->'text') IS DISTINCT FROM 'string'
      OR char_length(p_decision->>'text') > 200 THEN RETURN false; END IF;
  ELSIF p_decision ? 'text' THEN
    RETURN false;
  END IF;

  IF v_action = 'wait' THEN
    IF jsonb_typeof(p_decision->'wait_ms') IS DISTINCT FROM 'number'
      OR p_decision->>'wait_ms' !~ '^[0-9]{3,5}$'
      OR (p_decision->>'wait_ms')::integer NOT BETWEEN 500 AND 10000 THEN RETURN false; END IF;
  ELSIF p_decision ? 'wait_ms' THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE FUNCTION public.fb_supervision_expire_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.fb_supervision_requests
  SET status = 'expired', worker_id = NULL, lease_expires_at = NULL,
      error = 'La solicitud venció a los 120 segundos.'
  WHERE user_id = p_user_id AND status IN ('pending', 'processing')
    AND created_at <= now() - interval '120 seconds';

  UPDATE public.fb_supervision_requests
  SET status = 'pending', worker_id = NULL, lease_expires_at = NULL
  WHERE user_id = p_user_id AND status = 'processing'
    AND lease_expires_at <= now();
END;
$$;

CREATE FUNCTION public.facebook_supervision(
  p_token text,
  p_operation text,
  p_id uuid DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.facebook_devices%ROWTYPE;
  v_trace public.fb_run_traces%ROWTYPE;
  v_step public.fb_trace_steps%ROWTYPE;
  v_request public.fb_supervision_requests%ROWTYPE;
  v_match jsonb;
  v_success boolean;
  v_hint_step text;
  v_intent_key text;
  v_hints jsonb;
  v_request_id uuid;
  v_pending_count integer;
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text) > 30000 THEN
    RAISE EXCEPTION 'SUPERVISION_REQUEST_INVALID';
  END IF;

  SELECT device.* INTO v_device
  FROM public.facebook_devices AS device
  JOIN public.facebook_device_secrets AS secret ON secret.device_id = device.id
  WHERE device.revoked_at IS NULL
    AND secret.token_expires_at > now()
    AND secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    AND public.has_permission(device.user_id, 'config', 'write')
  FOR UPDATE OF device;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_REVOKED'; END IF;

  PERFORM public.fb_supervision_expire_for_user(v_device.user_id);

  IF p_operation = 'request' THEN
    IF p_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_data) AS item(key)
      WHERE item.key NOT IN ('kind', 'trace_id', 'step_seq', 'intent', 'dom_summary')
    ) OR coalesce(p_data->>'kind', '') NOT IN ('recover_step', 'verify_result', 'review_content', 'review_photos')
      OR coalesce(p_data->>'trace_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR coalesce(p_data->>'step_seq', '') !~ '^[1-9][0-9]{0,4}$'
      OR (p_data->>'step_seq')::integer > 10000
      OR jsonb_typeof(p_data->'intent') IS DISTINCT FROM 'object'
      OR octet_length(coalesce(p_data->'intent', '{}'::jsonb)::text) > 8192
      OR jsonb_typeof(p_data->'intent'->'step') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_data->'intent'->>'step')) NOT BETWEEN 1 AND 160
      OR jsonb_typeof(p_data->'intent'->'intent_key') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_data->'intent'->>'intent_key')) NOT BETWEEN 1 AND 240
      OR jsonb_typeof(p_data->'dom_summary') IS DISTINCT FROM 'object'
      OR octet_length(coalesce(p_data->'dom_summary', '{}'::jsonb)::text) > 20480
      OR jsonb_typeof(p_data->'dom_summary'->'controls') IS DISTINCT FROM 'array'
      OR jsonb_array_length(coalesce(p_data->'dom_summary'->'controls', '[]'::jsonb)) > 80 THEN
      RAISE EXCEPTION 'SUPERVISION_REQUEST_INVALID';
    END IF;

    SELECT * INTO v_trace
    FROM public.fb_run_traces
    WHERE id = (p_data->>'trace_id')::uuid AND user_id = v_device.user_id
      AND device_id = v_device.id AND finished_at IS NULL
      AND started_at > now() - interval '14 days'
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUPERVISION_TRACE_INVALID'; END IF;

    SELECT * INTO v_step
    FROM public.fb_trace_steps
    WHERE trace_id = v_trace.id AND seq = (p_data->>'step_seq')::integer
    FOR SHARE;
    IF NOT FOUND OR v_step.dom_summary IS DISTINCT FROM p_data->'dom_summary' THEN
      RAISE EXCEPTION 'SUPERVISION_DOM_MISMATCH';
    END IF;
    IF v_step.screenshot_path IS NOT NULL AND v_step.screenshot_path <> format('%s/%s/%s.jpg', v_device.user_id, v_trace.id, v_step.seq) THEN
      RAISE EXCEPTION 'SUPERVISION_SCREENSHOT_INVALID';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_device.user_id::text, 0));
    SELECT count(*)::integer INTO v_pending_count
    FROM public.fb_supervision_requests
    WHERE user_id = v_device.user_id AND status IN ('pending', 'processing');
    IF v_pending_count >= 10 THEN RAISE EXCEPTION 'SUPERVISION_PENDING_LIMIT_REACHED'; END IF;

    INSERT INTO public.fb_supervision_requests (
      user_id, trace_id, step_seq, kind, intent, dom_summary, screenshot_path
    ) VALUES (
      v_device.user_id, v_trace.id, (p_data->>'step_seq')::integer, p_data->>'kind',
      p_data->'intent', v_step.dom_summary, v_step.screenshot_path
    ) RETURNING id INTO v_request_id;
    RETURN jsonb_build_object('id', v_request_id, 'status', 'pending', 'expires_in_seconds', 120);
  ELSIF p_operation = 'poll' THEN
    IF p_id IS NULL OR p_data <> '{}'::jsonb THEN RAISE EXCEPTION 'SUPERVISION_REQUEST_INVALID'; END IF;
    SELECT request.* INTO v_request
    FROM public.fb_supervision_requests AS request
    JOIN public.fb_run_traces AS trace ON trace.id = request.trace_id
    WHERE request.id = p_id AND request.user_id = v_device.user_id AND trace.device_id = v_device.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUPERVISION_REQUEST_NOT_FOUND'; END IF;
    RETURN jsonb_build_object(
      'id', v_request.id, 'status', v_request.status,
      'decision', v_request.decision, 'provider', v_request.provider,
      'model_id', v_request.model_id, 'reasoning_effort', v_request.reasoning_effort,
      'error', v_request.error
    );
  ELSIF p_operation = 'report_outcome' THEN
    IF p_id IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_data) AS item(key) WHERE item.key NOT IN ('success', 'match')
    ) OR jsonb_typeof(p_data->'success') IS DISTINCT FROM 'boolean'
      OR NOT public.fb_supervision_hint_match_valid(p_data->'match') THEN
      RAISE EXCEPTION 'SUPERVISION_REQUEST_INVALID';
    END IF;
    SELECT request.* INTO v_request
    FROM public.fb_supervision_requests AS request
    JOIN public.fb_run_traces AS trace ON trace.id = request.trace_id
    WHERE request.id = p_id AND request.user_id = v_device.user_id AND trace.device_id = v_device.id
    FOR UPDATE OF request;
    IF NOT FOUND OR v_request.status <> 'answered' OR v_request.outcome_reported_at IS NOT NULL THEN
      RAISE EXCEPTION 'SUPERVISION_OUTCOME_STALE';
    END IF;

    v_success := (p_data->>'success')::boolean;
    v_match := p_data->'match';
    v_hint_step := v_request.intent->>'step';
    v_intent_key := v_request.intent->>'intent_key';
    INSERT INTO public.fb_learned_hints (
      user_id, step, intent_key, match, success_count, failure_count, last_used_at, source_request_id
    ) VALUES (
      v_request.user_id, v_hint_step, v_intent_key, v_match,
      CASE WHEN v_success THEN 1 ELSE 0 END,
      CASE WHEN v_success THEN 0 ELSE 1 END,
      now(), v_request.id
    )
    ON CONFLICT (user_id, step, intent_key, match) DO UPDATE SET
      success_count = public.fb_learned_hints.success_count + CASE WHEN v_success THEN 1 ELSE 0 END,
      failure_count = public.fb_learned_hints.failure_count + CASE WHEN v_success THEN 0 ELSE 1 END,
      last_used_at = now(),
      source_request_id = coalesce(public.fb_learned_hints.source_request_id, EXCLUDED.source_request_id);

    UPDATE public.fb_supervision_requests
    SET outcome_success = v_success, outcome_reported_at = now()
    WHERE id = v_request.id;
    RETURN jsonb_build_object('saved', true, 'success', v_success);
  ELSIF p_operation = 'hints' THEN
    IF p_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_data) AS item(key) WHERE item.key <> 'step'
    ) OR jsonb_typeof(p_data->'step') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_data->>'step')) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'SUPERVISION_REQUEST_INVALID';
    END IF;
    WITH candidates AS (
      SELECT hint.id
      FROM public.fb_learned_hints AS hint
      WHERE hint.user_id = v_device.user_id AND hint.step = btrim(p_data->>'step')
        AND hint.success_count - hint.failure_count >= 1
      ORDER BY hint.success_count - hint.failure_count DESC, hint.last_used_at DESC NULLS LAST, hint.created_at DESC
      LIMIT 50
      FOR UPDATE
    ), touched AS (
      UPDATE public.fb_learned_hints AS hint SET last_used_at = now()
      FROM candidates WHERE hint.id = candidates.id
      RETURNING hint.id, hint.step, hint.intent_key, hint.match, hint.success_count, hint.failure_count
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'step', step, 'intent_key', intent_key, 'match', match,
      'success_count', success_count, 'failure_count', failure_count
    ) ORDER BY success_count - failure_count DESC), '[]'::jsonb)
    INTO v_hints FROM touched;
    RETURN jsonb_build_object('hints', v_hints);
  ELSE
    RAISE EXCEPTION 'SUPERVISION_OPERATION_INVALID';
  END IF;
END;
$$;

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
DECLARE
  v_request public.fb_supervision_requests%ROWTYPE;
  v_decision jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF p_owner IS NULL OR p_worker IS NULL
    OR public.get_owner_uid(p_owner) IS DISTINCT FROM p_owner
    OR NOT EXISTS (
      SELECT 1 FROM public.ai_bridge_devices AS device
      WHERE device.id = p_worker AND device.user_id = p_owner AND device.revoked_at IS NULL
        AND device.last_seen_at > now() - interval '2 minutes'
    ) THEN
    RAISE EXCEPTION 'SUPERVISOR_WORKER_INVALID';
  END IF;
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text) > 12000 THEN
    RAISE EXCEPTION 'SUPERVISION_WORKER_REQUEST_INVALID';
  END IF;

  PERFORM public.fb_supervision_expire_for_user(p_owner);

  IF p_operation = 'next' THEN
    IF p_id IS NOT NULL OR p_data <> '{}'::jsonb THEN RAISE EXCEPTION 'SUPERVISION_WORKER_REQUEST_INVALID'; END IF;
    SELECT * INTO v_request
    FROM public.fb_supervision_requests
    WHERE user_id = p_owner AND status = 'pending'
      AND created_at > now() - interval '120 seconds'
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.fb_supervision_requests
    SET status = 'processing', worker_id = p_worker, lease_expires_at = now() + interval '70 seconds'
    WHERE id = v_request.id RETURNING * INTO v_request;
    RETURN jsonb_build_object(
      'id', v_request.id, 'trace_id', v_request.trace_id, 'step_seq', v_request.step_seq,
      'kind', v_request.kind, 'intent', v_request.intent, 'dom_summary', v_request.dom_summary,
      'screenshot_path', v_request.screenshot_path, 'lease_expires_at', v_request.lease_expires_at
    );
  ELSIF p_operation IN ('answer', 'fail') THEN
    IF p_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.fb_supervision_requests
      WHERE id = p_id AND user_id = p_owner AND status = 'processing'
        AND worker_id = p_worker AND lease_expires_at > now()
    ) THEN RAISE EXCEPTION 'SUPERVISION_LEASE_STALE'; END IF;

    SELECT * INTO v_request FROM public.fb_supervision_requests
    WHERE id = p_id AND user_id = p_owner FOR UPDATE;
    IF p_operation = 'answer' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(p_data) AS item(key)
        WHERE item.key NOT IN ('decision', 'provider', 'model_id', 'reasoning_effort')
      ) OR jsonb_typeof(p_data->'decision') IS DISTINCT FROM 'object'
        OR p_data->>'provider' NOT IN ('codex', 'claude')
        OR char_length(coalesce(p_data->>'model_id', '')) NOT BETWEEN 1 AND 80
        OR coalesce(p_data->>'reasoning_effort', '') NOT IN ('low', 'medium', 'high', 'xhigh')
        OR NOT public.fb_supervision_decision_valid(p_data->'decision', v_request.dom_summary) THEN
        RAISE EXCEPTION 'SUPERVISION_DECISION_INVALID';
      END IF;
      v_decision := p_data->'decision';
      UPDATE public.fb_supervision_requests
      SET status = 'answered', decision = v_decision, provider = p_data->>'provider',
          model_id = p_data->>'model_id', reasoning_effort = p_data->>'reasoning_effort',
          answered_at = now(), worker_id = NULL, lease_expires_at = NULL
      WHERE id = p_id;
      RETURN jsonb_build_object('saved', true, 'status', 'answered');
    END IF;

    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS item(key) WHERE item.key <> 'error')
      OR jsonb_typeof(p_data->'error') IS DISTINCT FROM 'string'
      OR char_length(coalesce(p_data->>'error', '')) > 500 THEN
      RAISE EXCEPTION 'SUPERVISION_WORKER_REQUEST_INVALID';
    END IF;
    UPDATE public.fb_supervision_requests
    SET status = 'failed', error = p_data->>'error', worker_id = NULL, lease_expires_at = NULL
    WHERE id = p_id;
    RETURN jsonb_build_object('saved', true, 'status', 'failed');
  ELSE
    RAISE EXCEPTION 'SUPERVISION_OPERATION_INVALID';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fb_supervision_hint_match_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_supervision_decision_valid(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_supervision_expire_for_user(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.facebook_supervision(text, text, uuid, jsonb) FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_supervision(text, text, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb) TO service_role;

COMMIT;

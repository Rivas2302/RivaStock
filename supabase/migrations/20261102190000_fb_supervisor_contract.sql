BEGIN;

CREATE OR REPLACE FUNCTION public.fb_supervision_decision_valid(p_decision jsonb, p_dom_summary jsonb)
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
  v_intent jsonb;
  v_target jsonb;
  v_number numeric;
  v_scope text;
  v_role text;
  v_name text;
  v_disabled text;
BEGIN
  IF jsonb_typeof(p_decision) IS DISTINCT FROM 'object'
    OR octet_length(p_decision::text) > 4096
    OR jsonb_typeof(p_dom_summary) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_dom_summary->'controls') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_dom_summary->'controls') > 80
    OR jsonb_typeof(p_decision->'action') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_decision->'confidence') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_decision->'observation') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_decision->'reason') IS DISTINCT FROM 'string'
    OR btrim(p_decision->>'observation') = ''
    OR btrim(p_decision->>'reason') = ''
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
    v_scope := p_dom_summary->>'scope';
    IF coalesce(v_scope, '') NOT IN ('dialog', 'form')
      OR jsonb_typeof(p_decision->'element_index') IS DISTINCT FROM 'number'
      OR p_decision->>'element_index' !~ '^(0|[1-9][0-9]?)$' THEN
      RETURN false;
    END IF;
    v_index := (p_decision->>'element_index')::integer;
    IF v_index < 0 OR v_index > 79 THEN RETURN false; END IF;

    SELECT control INTO v_control
    FROM jsonb_array_elements(p_dom_summary->'controls') AS item(control)
    WHERE item.control->>'index' = v_index::text
    LIMIT 1;
    v_disabled := v_control->'state'->>'disabled';
    IF v_control IS NULL OR v_disabled = 'true' THEN RETURN false; END IF;
    v_role := coalesce(v_control->>'role', '');
    v_name := coalesce(v_control->>'name', '');
    IF lower(v_name || ' ' || coalesce(v_control->>'text', ''))
      ~ '(publicar( ahora)?|compartir ahora|publish( now)?|share now|send now|enviar ahora|cerrar sesi[oó]n|log[[:space:]]*out|sign[[:space:]]*out|settings|configuraci[oó]n|account settings)' THEN
      RETURN false;
    END IF;
    IF v_action = 'click' AND v_role IN ('submit', 'formsubmit') THEN RETURN false; END IF;

    IF v_action IN ('type', 'select_option') THEN
      v_intent := p_dom_summary->'intent';
      v_target := v_intent->'target';
      IF jsonb_typeof(v_target) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_target->'element_index') IS DISTINCT FROM 'number'
        OR v_target->>'element_index' !~ '^(0|[1-9][0-9]?)$'
        OR (v_target->>'element_index')::integer <> v_index
        OR v_target->>'role' IS DISTINCT FROM v_role
        OR v_target->>'name' IS DISTINCT FROM v_name
        OR btrim(v_name) = ''
        OR jsonb_typeof(p_decision->'text') IS DISTINCT FROM 'string'
        OR char_length(p_decision->>'text') > 200 THEN
        RETURN false;
      END IF;
      IF v_action = 'type' AND v_role NOT IN ('input', 'textarea', 'textbox') THEN RETURN false; END IF;
      IF v_action = 'select_option' AND v_role NOT IN ('select', 'combobox') THEN RETURN false; END IF;
    ELSIF p_decision ? 'text' THEN
      RETURN false;
    END IF;
  ELSIF p_decision ? 'element_index' OR p_decision ? 'text' THEN
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

REVOKE ALL ON FUNCTION public.fb_supervision_decision_valid(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fb_supervisor_worker(
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
  v_validation_context jsonb;
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
        OR coalesce(p_data->>'reasoning_effort', '') NOT IN ('low', 'medium', 'high', 'xhigh') THEN
        RAISE EXCEPTION 'SUPERVISION_DECISION_INVALID';
      END IF;
      v_validation_context := v_request.dom_summary || jsonb_build_object('intent', v_request.intent);
      IF NOT public.fb_supervision_decision_valid(p_data->'decision', v_validation_context) THEN
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

REVOKE ALL ON FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_supervisor_worker(uuid, uuid, text, uuid, jsonb) TO service_role;

COMMIT;

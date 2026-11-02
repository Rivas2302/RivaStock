BEGIN;

ALTER FUNCTION public.fb_supervision_decision_valid(jsonb, jsonb)
  RENAME TO fb_supervision_menu_decision_valid;

CREATE FUNCTION public.fb_supervised_result_valid(p_assessment jsonb, p_dom_summary jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_found boolean;
  v_index integer;
  v_control jsonb;
  v_key text;
  v_key_count integer;
  v_confidence numeric;
BEGIN
  IF jsonb_typeof(p_assessment) IS DISTINCT FROM 'object'
    OR octet_length(p_assessment::text) > 4096
    OR jsonb_typeof(p_dom_summary) IS DISTINCT FROM 'object'
    OR p_dom_summary->>'scope' IS DISTINCT FROM 'page'
    OR jsonb_typeof(p_dom_summary->'controls') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_dom_summary->'controls') > 80
    OR jsonb_typeof(p_assessment->'found') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_assessment->'state') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_assessment->'observation') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_assessment->>'observation')) NOT BETWEEN 1 AND 300
    OR jsonb_typeof(p_assessment->'confidence') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_key_count FROM jsonb_object_keys(p_assessment);
  IF v_key_count <> 5 THEN RETURN false; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_assessment) LOOP
    IF v_key NOT IN ('found', 'element_index', 'state', 'observation', 'confidence') THEN
      RETURN false;
    END IF;
  END LOOP;

  v_found := (p_assessment->>'found')::boolean;
  v_confidence := (p_assessment->>'confidence')::numeric;
  IF v_confidence < 0 OR v_confidence > 1
    OR p_assessment->>'state' NOT IN ('published', 'pending_approval', 'not_approved', 'unknown') THEN
    RETURN false;
  END IF;

  IF NOT v_found THEN
    RETURN jsonb_typeof(p_assessment->'element_index') = 'null'
      AND p_assessment->>'state' = 'unknown';
  END IF;

  IF jsonb_typeof(p_assessment->'element_index') IS DISTINCT FROM 'number'
    OR p_assessment->>'element_index' !~ '^(0|[1-9][0-9]?)$' THEN
    RETURN false;
  END IF;
  v_index := (p_assessment->>'element_index')::integer;
  IF v_index NOT BETWEEN 0 AND 79 THEN RETURN false; END IF;

  SELECT control INTO v_control
  FROM jsonb_array_elements(p_dom_summary->'controls') AS item(control)
  WHERE item.control->'index' = to_jsonb(v_index)
    AND item.control->>'role' = 'article'
    AND jsonb_typeof(item.control->'links') = 'array'
    AND jsonb_array_length(item.control->'links') BETWEEN 1 AND 5
  LIMIT 1;
  IF v_control IS NULL THEN RETURN false; END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_control->'links') AS item(link)
    WHERE jsonb_typeof(item.link) IS DISTINCT FROM 'string'
      OR char_length(item.link #>> '{}') > 300
      OR (item.link #>> '{}') !~ '^https://www\.facebook\.com/[A-Za-z0-9._~!$&''()*+,;=:@%/?-]*$'
  );
END;
$$;

CREATE FUNCTION public.fb_supervision_decision_valid(p_decision jsonb, p_dom_summary jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_dom_summary->'intent'->>'supervisor_kind' = 'verify_result' THEN
    RETURN public.fb_supervised_result_valid(p_decision, p_dom_summary);
  END IF;
  RETURN public.fb_supervision_menu_decision_valid(p_decision, p_dom_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.fb_supervision_menu_decision_valid(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_supervised_result_valid(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_supervision_decision_valid(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

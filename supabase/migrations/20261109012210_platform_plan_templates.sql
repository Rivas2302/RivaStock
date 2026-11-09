CREATE OR REPLACE FUNCTION public.platform_save_plan_template(
  p_code text,
  p_name text,
  p_limits jsonb,
  p_is_active boolean DEFAULT true
)
RETURNS public.business_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := p_code;
  v_plan public.business_plans%ROWTYPE;
  v_sort_order integer;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'platform-plan-template-name-invalid';
  END IF;
  IF p_limits IS NULL OR jsonb_typeof(p_limits) <> 'object'
    OR jsonb_typeof(p_limits->'modules') <> 'object'
    OR jsonb_typeof(p_limits->'modules'->'ai') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_limits->'modules'->'knowledge') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_limits->'modules'->'automation') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_limits->'collaborators') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_limits->'trace_retention_days') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'platform-plan-template-limits-invalid';
  END IF;
  IF (p_limits->>'collaborators')::numeric < 0 OR (p_limits->>'collaborators')::numeric > 1000
    OR trunc((p_limits->>'collaborators')::numeric) <> (p_limits->>'collaborators')::numeric
    OR (p_limits->>'trace_retention_days')::numeric < 0 OR (p_limits->>'trace_retention_days')::numeric > 14
    OR trunc((p_limits->>'trace_retention_days')::numeric) <> (p_limits->>'trace_retention_days')::numeric THEN
    RAISE EXCEPTION 'platform-plan-template-limits-invalid';
  END IF;
  IF p_is_active IS NULL THEN RAISE EXCEPTION 'platform-plan-template-active-invalid'; END IF;

  IF v_code IS NULL THEN
    v_code := 'plantilla_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    SELECT COALESCE(max(sort_order), 0) + 10 INTO v_sort_order FROM public.business_plans;
    INSERT INTO public.business_plans(code, name, limits, is_active, sort_order)
      VALUES (v_code, btrim(p_name), p_limits, p_is_active, v_sort_order)
      RETURNING * INTO v_plan;
    RETURN v_plan;
  END IF;

  IF v_code !~ '^[a-z][a-z0-9_]{1,30}$' OR v_code = 'interno' THEN
    RAISE EXCEPTION 'platform-plan-template-protected';
  END IF;
  UPDATE public.business_plans
    SET name = btrim(p_name), limits = p_limits, is_active = p_is_active, updated_at = now()
    WHERE code = v_code AND code <> 'interno'
    RETURNING * INTO v_plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-plan-template-not-found'; END IF;
  RETURN v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_save_plan_template(text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_plan_template(text, text, jsonb, boolean) TO authenticated;

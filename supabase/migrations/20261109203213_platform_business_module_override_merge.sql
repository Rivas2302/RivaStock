CREATE OR REPLACE FUNCTION public.business_limits(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE(d.limits, '{}'::jsonb)
    || COALESCE(p.limits, '{}'::jsonb)
    || (COALESCE(s.limit_overrides, '{}'::jsonb) - 'modules')
    || jsonb_build_object(
      'modules',
      (CASE WHEN jsonb_typeof(d.limits->'modules') = 'object' THEN d.limits->'modules' ELSE '{}'::jsonb END)
      || (CASE WHEN jsonb_typeof(p.limits->'modules') = 'object' THEN p.limits->'modules' ELSE '{}'::jsonb END)
      || (CASE WHEN jsonb_typeof(s.limit_overrides->'modules') = 'object' THEN s.limit_overrides->'modules' ELSE '{}'::jsonb END)
    )
  FROM public.business_plans d
  LEFT JOIN public.business_subscriptions s ON s.owner_uid = p_owner
  LEFT JOIN public.business_plans p ON p.code = s.plan_code
  WHERE d.code = 'base'
$$;

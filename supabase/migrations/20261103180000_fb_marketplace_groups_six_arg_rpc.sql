BEGIN;

-- Keep the repeat-aware implementation private behind exact RPC signatures.
-- The six-argument entry point is the public contract in the execution plan;
-- the seven-argument overload preserves the existing explicit-repeat flow.
ALTER FUNCTION public.approve_facebook_publication_v2(
  uuid, uuid, jsonb, uuid[], boolean, text, uuid
) RENAME TO approve_facebook_publication_v2_with_repeat;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2_with_repeat(
  uuid, uuid, jsonb, uuid[], boolean, text, uuid
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid,
  p_intent uuid,
  p_content jsonb,
  p_groups uuid[],
  p_marketplace boolean,
  p_mode text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.approve_facebook_publication_v2_with_repeat(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, NULL
  );
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(
  uuid, uuid, jsonb, uuid[], boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(
  uuid, uuid, jsonb, uuid[], boolean, text
) TO authenticated;

CREATE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid,
  p_intent uuid,
  p_content jsonb,
  p_groups uuid[],
  p_marketplace boolean,
  p_mode text,
  p_repeat_of uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.approve_facebook_publication_v2_with_repeat(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, p_repeat_of
  );
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(
  uuid, uuid, jsonb, uuid[], boolean, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(
  uuid, uuid, jsonb, uuid[], boolean, text, uuid
) TO authenticated;

COMMIT;

-- Expose collaborator display names to the signed-in business owner without
-- granting access to profiles belonging to other businesses.
CREATE OR REPLACE FUNCTION public.list_collaborators_with_names()
RETURNS TABLE (
  id uuid,
  owner_uid uuid,
  user_uid uuid,
  email text,
  permissions jsonb,
  role_preset text,
  invitation_id uuid,
  created_at timestamptz,
  revoked_at timestamptz,
  is_pending boolean,
  display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    c.owner_uid,
    c.user_uid,
    c.email,
    c.permissions,
    c.role_preset,
    c.invitation_id,
    c.created_at,
    c.revoked_at,
    (u.email_confirmed_at IS NULL) AS is_pending,
    NULLIF(BTRIM(p.display_name), '') AS display_name
  FROM public.collaborators AS c
  LEFT JOIN public.profiles AS p ON p.id = c.user_uid
  LEFT JOIN auth.users AS u ON u.id = c.user_uid
  WHERE c.owner_uid = (SELECT auth.uid())
  ORDER BY c.revoked_at NULLS FIRST, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_collaborators_with_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_collaborators_with_names() TO authenticated;

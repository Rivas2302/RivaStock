BEGIN;

-- Quote IDs act as unguessable share tokens. Do not expose the table for
-- anonymous enumeration; serve only the public projection for one known ID.
DROP POLICY IF EXISTS "quotes_public_read_by_id" ON public.quotes;
REVOKE SELECT ON public.quotes FROM PUBLIC, anon;
-- This legacy view runs with its owner privileges and bypasses the table's RLS.
-- No application code uses it; owners use the protected table directly.
REVOKE SELECT ON public.quotes_with_status FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_quote(p_quote_id uuid)
RETURNS TABLE (
  id uuid,
  number text,
  client_name text,
  client_phone text,
  client_email text,
  items jsonb,
  subtotal numeric,
  discount numeric,
  total numeric,
  expires_at timestamptz,
  notes text,
  created_at timestamptz,
  business_name text,
  business_phone text,
  email_contact text,
  currency_symbol text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    q.id,
    q.number,
    q.client_name,
    q.client_phone,
    q.client_email,
    q.items,
    q.subtotal,
    q.discount,
    q.total,
    q.expires_at,
    q.notes,
    q.created_at,
    profile.business_name,
    profile.phone AS business_phone,
    profile.email_contact,
    profile.currency_symbol
  FROM public.quotes AS q
  LEFT JOIN public.profiles AS profile ON profile.id = q.user_id
  WHERE q.id = p_quote_id;
$function$;

REVOKE ALL ON FUNCTION public.get_public_quote(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_quote(uuid) TO anon, authenticated;

COMMIT;

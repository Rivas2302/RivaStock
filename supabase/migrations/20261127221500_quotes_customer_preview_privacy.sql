BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS internal_notes text NOT NULL DEFAULT '';

-- Preserve existing free-form notes privately before clearing the public field.
UPDATE public.quotes
SET internal_notes = notes,
    notes = ''
WHERE COALESCE(notes, '') <> ''
  AND COALESCE(internal_notes, '') = '';

DROP FUNCTION IF EXISTS public.get_public_quote_with_shipping(uuid);

CREATE FUNCTION public.get_public_quote_with_shipping(p_quote_id uuid)
RETURNS TABLE (
  id uuid,
  number text,
  client_name text,
  client_phone text,
  client_email text,
  items jsonb,
  subtotal numeric,
  discount numeric,
  shipping_amount numeric,
  total numeric,
  expires_at timestamptz,
  notes text,
  created_at timestamptz,
  business_name text,
  business_phone text,
  email_contact text,
  currency_symbol text,
  logo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT q.id, q.number, q.client_name, q.client_phone, q.client_email,
    q.items, q.subtotal, q.discount, q.shipping_amount, q.total,
    q.expires_at, q.notes, q.created_at,
    COALESCE(NULLIF(catalog.business_name, ''), profile.business_name),
    profile.phone, profile.email_contact, profile.currency_symbol,
    catalog.logo_url
  FROM public.quotes AS q
  LEFT JOIN public.profiles AS profile ON profile.id = q.user_id
  LEFT JOIN LATERAL (
    SELECT config.business_name, config.logo_url
    FROM public.catalog_config AS config
    WHERE config.user_id = q.user_id
    ORDER BY config.updated_at DESC NULLS LAST
    LIMIT 1
  ) AS catalog ON TRUE
  WHERE q.id = p_quote_id;
$$;

REVOKE ALL ON FUNCTION public.get_public_quote_with_shipping(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_quote_with_shipping(uuid) TO anon, authenticated;

COMMIT;

-- Text search helpers for Knowledge. Kept separate so tests can stub it.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.kb_unaccent(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = ''
AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_value))
$$;

REVOKE ALL ON FUNCTION public.kb_unaccent(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kb_unaccent(text) TO authenticated, service_role;

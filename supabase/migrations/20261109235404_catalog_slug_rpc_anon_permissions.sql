-- Slug availability and suggestions are owner-only RPCs. Public metadata and
-- old-link resolution remain available to anon through resolve_public_catalog_slug.
REVOKE EXECUTE ON FUNCTION public.catalog_slug_available(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.suggest_catalog_slug(text, text) FROM anon;

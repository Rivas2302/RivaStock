-- The catalog slug expression index evaluates this canonicalizer when an
-- authenticated owner updates catalog_config.slug. It is immutable and only
-- normalizes the supplied text, so it is safe for that role to execute.
GRANT EXECUTE ON FUNCTION public.catalog_slug_key(text) TO authenticated;

BEGIN;

-- The public profile view is no longer used by the application. Public quote
-- links now receive a narrow profile projection from get_public_quote().
REVOKE ALL ON public.public_profiles FROM PUBLIC, anon, authenticated;

COMMIT;

REVOKE ALL ON FUNCTION public.request_fb_copywriting(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_fb_copywriting(uuid, uuid, text, text, text, text)
  TO authenticated;
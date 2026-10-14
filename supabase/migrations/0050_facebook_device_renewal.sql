-- Preserve the existing authorization and operation checks; extend only a
-- valid capability after a successful operation. Expired/revoked devices
-- cannot renew themselves. The base implementation is not publicly callable.
ALTER FUNCTION public.facebook_worker(text,text,uuid,text,text,text) RENAME TO facebook_worker_base;
REVOKE ALL ON FUNCTION public.facebook_worker_base(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  result := public.facebook_worker_base(p_token,p_operation,p_delivery,p_message,p_status,p_url);
  UPDATE public.facebook_device_secrets s SET token_expires_at=now()+interval '30 days'
    FROM public.facebook_devices d WHERE d.id=s.device_id AND d.revoked_at IS NULL
    AND s.token_expires_at>now() AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.facebook_worker(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_worker(text,text,uuid,text,text,text) TO anon,authenticated;

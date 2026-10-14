-- Retry the immutable approved delivery only before its submit checkpoint.
CREATE FUNCTION public.retry_facebook_preparation(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE facebook_deliveries d
    SET status='pending',device_id=NULL,claimed_at=NULL,updated_at=now(),message='Preparación reactivada por el usuario'
    FROM facebook_publications p
    WHERE d.id=p_delivery AND p.id=d.publication_id
      AND p.user_id=get_owner_uid(auth.uid())
      AND facebook_product_allowed(auth.uid(),p.product_id,true)
      AND facebook_product_allowed(p.approved_by,p.product_id,true)
      AND d.status='attention' AND d.submitted_at IS NULL AND d.evidence_url IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se puede reintentar: el envío pudo comenzar o no tenés permiso'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_facebook_preparation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_facebook_preparation(uuid) TO authenticated;

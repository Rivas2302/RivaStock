BEGIN;

-- A failed preparation never authorized a click, so a person may close it
-- truthfully. This also gives every issue kind (for example
-- group_sale_audience, which resolve and retry reject) an exit. Authorized or
-- contradicted deliveries still require a review and are never cancelled here.
CREATE OR REPLACE FUNCTION cancel_facebook_delivery(p_delivery uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries;
BEGIN
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
   WHERE d.id=p_delivery AND p.user_id=get_owner_uid(auth.uid()) AND facebook_product_allowed(auth.uid(),p.product_id,true)
   FOR UPDATE OF d;
  IF NOT FOUND OR NOT (v_job.status='pending' OR (v_job.status='attention' AND v_job.submitted_at IS NULL AND NOT v_job.recovery_required)) THEN
    RAISE EXCEPTION 'El envío ya comenzó o no tenés permiso';
  END IF;
  IF v_job.status='attention' THEN
    UPDATE facebook_delivery_attempts SET finished_at=coalesce(finished_at,now()),outcome=coalesce(outcome,'interrupted')
     WHERE delivery_id=p_delivery AND finished_at IS NULL;
  END IF;
  UPDATE facebook_deliveries SET status='cancelled',updated_at=now(),active_attempt_id=NULL,
   message=CASE WHEN v_job.status='pending' THEN 'Cancelado antes del envío' ELSE 'Cancelado por decisión humana: preparación sin envío autorizado.' END
   WHERE id=p_delivery;
END;
$$;
REVOKE ALL ON FUNCTION cancel_facebook_delivery(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION cancel_facebook_delivery(uuid) TO authenticated;

COMMIT;

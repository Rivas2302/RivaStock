BEGIN;

-- Human review must be able to record the truth in every case:
-- * exists_without_link: the post exists but there is no verifiable permalink
--   (for example, it waits for the group admins). It never cancels the delivery,
--   so it cannot unlock another submission to the destination.
-- * found accepts the destination's own segment or a numeric group id (the other
--   alias Facebook uses in post URLs), never another named group, and never a
--   post that is already the evidence of another delivery. Automatic results
--   keep the strict validator.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid='facebook_delivery_reviews'::regclass
  AND contype='c'
  AND pg_get_constraintdef(oid) ILIKE '%decision%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE facebook_delivery_reviews DROP CONSTRAINT %I', cname);
  END IF;
END; $$;
ALTER TABLE facebook_delivery_reviews
  ADD CONSTRAINT facebook_delivery_reviews_decision_check
  CHECK (decision IN ('found','not_found','exists_without_link'));

CREATE FUNCTION facebook_valid_review_url(p_url text,p_destination jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT facebook_valid_evidence_url(p_url,p_destination)
  OR coalesce(p_destination->>'mechanism'='group_direct'
   AND p_url ~ '^https://www\.facebook\.com/groups/[0-9]+/(posts|permalink)/[0-9]+/?$',false);
$$;
REVOKE ALL ON FUNCTION facebook_valid_review_url(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION review_facebook_attempt(p_attempt uuid,p_decision text,p_url text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_pub facebook_publications;
BEGIN
 SELECT p.* INTO v_pub FROM facebook_publications p JOIN facebook_deliveries d ON d.publication_id=p.id JOIN facebook_delivery_attempts a ON a.delivery_id=d.id WHERE a.id=p_attempt;
 IF NOT FOUND OR NOT facebook_product_allowed(auth.uid(),v_pub.product_id,true) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_pub.user_id::text||v_pub.product_id::text,0));
 SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_delivery_attempts a ON a.delivery_id=d.id WHERE a.id=p_attempt FOR UPDATE OF d;
 IF NOT v_job.recovery_required AND (v_job.status<>'attention' OR v_job.submitted_at IS NULL) THEN RAISE EXCEPTION 'El resultado no requiere revisión'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('found','not_found','exists_without_link')
  OR (p_decision='found' AND (NOT facebook_valid_review_url(p_url,v_job.destination) OR facebook_evidence_in_use(v_pub.user_id,v_job.id,p_url)))
  OR (p_decision IN ('not_found','exists_without_link') AND p_url IS NOT NULL) THEN RAISE EXCEPTION 'Decisión inválida'; END IF;
 INSERT INTO facebook_delivery_reviews(delivery_id,reviewed_by,decision,evidence_url) VALUES(v_job.id,auth.uid(),p_decision,p_url);
 PERFORM facebook_attempt_event(p_attempt,'review',jsonb_build_object('decision',p_decision,'url',p_url,'actor',auth.uid()),'review-'||gen_random_uuid()::text);
 UPDATE facebook_delivery_attempts SET finished_at=coalesce(finished_at,now()),outcome=coalesce(outcome,'unknown') WHERE id=p_attempt;
 UPDATE facebook_deliveries SET recovery_required=false,active_attempt_id=NULL,updated_at=now(),
 status=CASE WHEN status IN ('submitted','published','pending_approval') THEN status WHEN p_decision='found' THEN 'submitted' WHEN p_decision='exists_without_link' THEN 'pending_approval' ELSE 'cancelled' END,
 evidence_url=CASE WHEN status IN ('submitted','published','pending_approval') THEN evidence_url ELSE p_url END,
 message=CASE WHEN status IN ('submitted','published','pending_approval') THEN message WHEN p_decision='exists_without_link' THEN 'Revisión humana: la publicación existe sin enlace verificable.' ELSE message END
 WHERE id=v_job.id;
END; $$;
REVOKE ALL ON FUNCTION review_facebook_attempt(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION review_facebook_attempt(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION review_facebook_delivery(p_delivery uuid,p_decision text,p_url text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE attempt uuid; v_job facebook_deliveries;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=p_delivery AND facebook_product_allowed(auth.uid(),p.product_id,true)) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 IF EXISTS(SELECT 1 FROM facebook_deliveries WHERE id=p_delivery AND recovery_required) THEN RAISE EXCEPTION 'RECOVERY_REQUIRED'; END IF;
 SELECT id INTO attempt FROM facebook_delivery_attempts WHERE delivery_id=p_delivery ORDER BY started_at DESC,id DESC LIMIT 1;
 IF attempt IS NOT NULL THEN PERFORM review_facebook_attempt(attempt,p_decision,p_url);
 ELSIF p_decision='exists_without_link' THEN
  -- Legacy deliveries authorized before attempts existed.
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
   WHERE d.id=p_delivery AND p.user_id=get_owner_uid(auth.uid()) FOR UPDATE OF d;
  IF NOT FOUND OR v_job.status<>'attention' OR v_job.submitted_at IS NULL THEN RAISE EXCEPTION 'El resultado no requiere revisión o no tenés permiso'; END IF;
  IF p_url IS NOT NULL THEN RAISE EXCEPTION 'Decisión inválida'; END IF;
  INSERT INTO facebook_delivery_reviews(delivery_id,reviewed_by,decision,evidence_url) VALUES(p_delivery,auth.uid(),p_decision,NULL);
  UPDATE facebook_deliveries SET status='pending_approval',evidence_url=NULL,active_attempt_id=NULL,updated_at=now(),
   message='Revisión humana: la publicación existe sin enlace verificable.' WHERE id=p_delivery;
 ELSE PERFORM review_facebook_delivery_before_attempts(p_delivery,p_decision,p_url); END IF;
END; $$;
REVOKE ALL ON FUNCTION review_facebook_delivery(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION review_facebook_delivery(uuid,text,text) TO authenticated;

COMMIT;

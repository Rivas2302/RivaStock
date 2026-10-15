BEGIN;

-- Migration order is intentional: 0052-0059 are required, never emulated for a test fixture.
CREATE FUNCTION facebook_destination_key(p_destination jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_destination->>'mechanism'='marketplace' THEN 'marketplace' ELSE facebook_group_key(p_destination->>'url') END;
$$;
REVOKE ALL ON FUNCTION facebook_destination_key(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_valid_evidence_url(p_url text,p_destination jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(CASE WHEN p_destination->>'mechanism'='marketplace' THEN p_url ~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$'
 ELSE p_url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/(posts|permalink)/[0-9]+/?$'
 AND facebook_group_key('https://www.facebook.com/groups/'||split_part(p_url,'/',5))=facebook_group_key(p_destination->>'url') END,false);
$$;
REVOKE ALL ON FUNCTION facebook_valid_evidence_url(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_attempt_event(p_attempt uuid,p_type text,p_data jsonb,p_idempotency_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>8192 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 INSERT INTO facebook_delivery_attempt_events(attempt_id,type,data,idempotency_key) VALUES(p_attempt,p_type,p_data,p_idempotency_key)
 ON CONFLICT(attempt_id,idempotency_key) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION facebook_attempt_event(uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_assert_recovery_clear(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_pub facebook_publications;
BEGIN
 SELECT * INTO v_job FROM facebook_deliveries WHERE id=p_delivery;
 SELECT * INTO v_pub FROM facebook_publications WHERE id=v_job.publication_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_pub.user_id::text||v_pub.product_id::text,0));
 IF EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
 WHERE p.user_id=v_pub.user_id AND p.product_id=v_pub.product_id AND d.recovery_required
 AND facebook_destination_key(d.destination)=facebook_destination_key(v_job.destination)) THEN RAISE EXCEPTION 'RECOVERY_REQUIRED'; END IF;
END; $$;
REVOKE ALL ON FUNCTION facebook_assert_recovery_clear(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION facebook_worker_v2(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_job facebook_deliveries; v_pub facebook_publications; v_attempt facebook_delivery_attempts;
 v_now timestamptz:=clock_timestamp(); v_key uuid; v_status text; v_url text; v_policy integer; v_lease timestamptz;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>30000 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 -- Serialize product decisions before taking device/delivery/attempt locks.
 IF p_attempt IS NOT NULL THEN
  SELECT p.* INTO v_pub FROM facebook_delivery_attempts a JOIN facebook_deliveries d ON d.id=a.delivery_id
   JOIN facebook_publications p ON p.id=d.publication_id JOIN facebook_devices dev ON dev.id=a.device_id
   JOIN facebook_device_secrets s ON s.device_id=dev.id
   WHERE a.id=p_attempt AND p.user_id=dev.user_id AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF FOUND THEN PERFORM pg_advisory_xact_lock(hashtextextended(v_pub.user_id::text||v_pub.product_id::text,0)); END IF;
 END IF;
 SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
 WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'TOKEN_EXPIRED'; END IF;
 IF v_device.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'DEVICE_REVOKED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM facebook_device_secrets WHERE device_id=v_device.id AND token_expires_at>v_now) THEN RAISE EXCEPTION 'TOKEN_EXPIRED'; END IF;
 IF NOT has_permission(v_device.user_id,'config','write') THEN RAISE EXCEPTION 'DEVICE_PERMISSION_REVOKED'; END IF;
 UPDATE facebook_device_secrets SET token_expires_at=v_now+interval '30 days' WHERE device_id=v_device.id;
 UPDATE facebook_devices SET last_seen_at=v_now,worker_protocol=2,extension_version=coalesce(left(p_data->>'version',40),extension_version),
 capabilities=CASE WHEN jsonb_typeof(p_data->'capabilities')='array' THEN p_data->'capabilities' ELSE capabilities END,
 execution_state=CASE WHEN p_data->>'status' IN ('active','paused') THEN p_data->>'status' ELSE execution_state END WHERE id=v_device.id;
 v_policy:=coalesce((SELECT required_protocol FROM facebook_worker_policy WHERE user_id=v_device.user_id),1);
 IF p_operation='heartbeat' THEN RETURN jsonb_build_object('connected',true,'worker_protocol',2,'queue_enabled',v_device.queue_enabled,'queue_command_at',v_device.queue_command_at,'required_protocol',v_policy); END IF;
 IF p_operation='queue_state' THEN
  IF coalesce(p_data->>'status','') NOT IN ('active','paused') THEN RAISE EXCEPTION 'QUEUE_STATE_INVALID'; END IF;
  UPDATE facebook_devices SET queue_enabled=(p_data->>'status'='active'),queue_command_at=v_now,execution_state=p_data->>'status' WHERE id=v_device.id;
  RETURN jsonb_build_object('queue_enabled',p_data->>'status'='active','queue_command_at',v_now);
 END IF;
 IF p_operation='claim' THEN
  IF NOT(coalesce(v_device.capabilities,'[]'::jsonb) @> '["attempts","causal-results","recovery"]'::jsonb) THEN RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED'; END IF;
  IF p_data->>'claimKey' IS NULL THEN RAISE EXCEPTION 'CLAIM_KEY_REQUIRED'; END IF;
  v_key:=(p_data->>'claimKey')::uuid;
  SELECT * INTO v_attempt FROM facebook_delivery_attempts WHERE device_id=v_device.id AND claim_key=v_key;
  IF FOUND THEN
   SELECT * INTO v_job FROM facebook_deliveries WHERE id=v_attempt.delivery_id;
   SELECT * INTO v_pub FROM facebook_publications WHERE id=v_job.publication_id;
   RETURN jsonb_build_object('id',v_job.id,'attemptId',v_attempt.id,'claimKey',v_key,'recovered',true,'destination',v_job.destination,'content',v_pub.content||jsonb_build_object('allowRepublish',v_pub.repeat_of IS NOT NULL OR v_job.resolution->>'action'='new','deliveryResolution',coalesce(v_job.resolution,'{}'::jsonb)));
  END IF;
  IF NOT v_device.queue_enabled THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM facebook_delivery_attempts WHERE device_id=v_device.id AND finished_at IS NULL)
   OR EXISTS(SELECT 1 FROM facebook_deliveries WHERE device_id=v_device.id AND status='running' AND active_attempt_id IS NULL) THEN RAISE EXCEPTION 'ATTEMPT_RECOVERY_REQUIRED'; END IF;
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
  WHERE p.user_id=v_device.user_id AND d.status='pending' AND NOT d.recovery_required AND facebook_product_allowed(p.approved_by,p.product_id,true)
   AND NOT EXISTS(SELECT 1 FROM facebook_deliveries conflict JOIN facebook_publications cp ON cp.id=conflict.publication_id
    WHERE cp.user_id=p.user_id AND cp.product_id=p.product_id AND conflict.recovery_required AND facebook_destination_key(conflict.destination)=facebook_destination_key(d.destination))
  ORDER BY p.approved_at,(d.destination->>'mechanism'='marketplace') DESC,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO facebook_delivery_attempts(delivery_id,device_id,claim_key) VALUES(v_job.id,v_device.id,v_key) RETURNING * INTO v_attempt;
  UPDATE facebook_deliveries SET status='running',device_id=v_device.id,claimed_at=v_now,updated_at=v_now,active_attempt_id=v_attempt.id WHERE id=v_job.id;
  SELECT * INTO v_pub FROM facebook_publications WHERE id=v_job.publication_id;
  PERFORM facebook_attempt_event(v_attempt.id,'claim','{}','claim');
  RETURN jsonb_build_object('id',v_job.id,'attemptId',v_attempt.id,'claimKey',v_key,'destination',v_job.destination,'content',v_pub.content||jsonb_build_object('allowRepublish',coalesce(v_pub.repeat_of IS NOT NULL OR v_job.resolution->>'action'='new',false),'deliveryResolution',coalesce(v_job.resolution,'{}'::jsonb)));
 END IF;
 SELECT d.* INTO v_job FROM facebook_delivery_attempts a JOIN facebook_deliveries d ON d.id=a.delivery_id
  JOIN facebook_publications p ON p.id=d.publication_id WHERE a.id=p_attempt AND a.device_id=v_device.id AND p.user_id=v_device.user_id FOR UPDATE OF d;
 IF NOT FOUND OR (p_delivery IS NOT NULL AND p_delivery<>v_job.id) THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
 SELECT * INTO v_attempt FROM facebook_delivery_attempts WHERE id=p_attempt FOR UPDATE;
 IF p_operation='result' THEN
  v_status:=p_data->>'status'; v_url:=p_data->>'url';
  IF coalesce(v_status,'') NOT IN ('submitted','published','pending_approval') OR v_attempt.authorized_at IS NULL THEN RAISE EXCEPTION 'RESULT_INVALID'; END IF;
  IF (v_url IS NULL AND v_status<>'pending_approval') OR (v_url IS NOT NULL AND NOT facebook_valid_evidence_url(v_url,v_job.destination))
   OR (v_status='published' AND v_job.destination->>'mechanism'='marketplace') THEN RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID'; END IF;
  IF v_attempt.evidence=p_data AND v_attempt.outcome=v_status THEN RETURN jsonb_build_object('saved',true,'retired',true); END IF;
  IF EXISTS(SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=p_attempt AND idempotency_key='result-'||encode(sha256(convert_to(p_data::text,'UTF8')),'hex')) THEN RETURN jsonb_build_object('saved',true,'retired',true,'reviewed',true); END IF;
  PERFORM facebook_attempt_event(p_attempt,'result',p_data,'result-'||encode(sha256(convert_to(p_data::text,'UTF8')),'hex'));
  IF v_job.status IN ('submitted','published','pending_approval','cancelled') OR (v_job.active_attempt_id IS NOT NULL AND v_job.active_attempt_id<>p_attempt)
   OR EXISTS(SELECT 1 FROM facebook_delivery_reviews WHERE delivery_id=v_job.id) THEN
   UPDATE facebook_deliveries SET recovery_required=true WHERE id=v_job.id;
   PERFORM facebook_attempt_event(p_attempt,'contradiction',jsonb_build_object('new_status',v_status,'new_url',v_url),'contradiction-'||encode(sha256(convert_to(p_data::text,'UTF8')),'hex'));
   RETURN jsonb_build_object('saved',true,'reviewed',true,'recovery_required',true,'retired',true);
  END IF;
  UPDATE facebook_delivery_attempts SET finished_at=v_now,outcome=v_status,evidence=p_data WHERE id=p_attempt;
  UPDATE facebook_deliveries SET status=v_status,evidence_url=v_url,message=left(p_data->>'message',1000),updated_at=v_now,active_attempt_id=NULL WHERE id=v_job.id;
  RETURN jsonb_build_object('saved',true,'retired',true);
 END IF;
 IF p_operation='recover' THEN
  IF v_attempt.finished_at IS NOT NULL OR v_job.active_attempt_id IS DISTINCT FROM p_attempt OR v_job.status<>'running' THEN
   RETURN jsonb_build_object('action','retire','phase',coalesce(v_attempt.outcome,v_job.status));
  END IF;
  IF v_attempt.authorized_at IS NOT NULL THEN RETURN jsonb_build_object('action','reconcile_only','phase','authorized'); END IF;
  UPDATE facebook_delivery_attempts SET finished_at=v_now,outcome='interrupted',last_error_code='PREPARATION_INTERRUPTED' WHERE id=p_attempt;
  UPDATE facebook_deliveries SET status='attention',message='Preparación interrumpida; no se autorizó el envío.',active_attempt_id=NULL,updated_at=v_now WHERE id=v_job.id;
  RETURN jsonb_build_object('action','retire','phase','interrupted');
 END IF;
 IF v_attempt.finished_at IS NOT NULL THEN
  IF p_operation IN ('attention','issue') THEN RETURN jsonb_build_object('saved',true,'retired',true); END IF;
  RAISE EXCEPTION 'ATTEMPT_STALE';
 END IF;
 IF v_job.active_attempt_id IS DISTINCT FROM p_attempt OR v_job.status<>'running' THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
 IF p_operation IN ('attention','issue') THEN
  IF p_operation='issue' AND v_attempt.authorized_at IS NOT NULL THEN RAISE EXCEPTION 'RESULT_UNKNOWN'; END IF;
  IF p_operation='issue' THEN
   -- Reuse the existing scoped decision validator, not an unvalidated JSON write.
   PERFORM facebook_worker_legacy_dispatch(p_token,'issue',v_job.id,(p_data->'issue')::text);
  ELSE
   UPDATE facebook_deliveries SET status='attention',message=left(coalesce(p_data->>'message','Requiere revisión'),1000),updated_at=v_now WHERE id=v_job.id;
  END IF;
  UPDATE facebook_delivery_attempts SET finished_at=v_now,outcome=CASE WHEN authorized_at IS NULL THEN 'interrupted' ELSE 'unknown' END,
   last_error_code=CASE WHEN authorized_at IS NULL THEN 'PREPARATION_INTERRUPTED' ELSE 'RESULT_UNKNOWN' END WHERE id=p_attempt;
  UPDATE facebook_devices SET last_error_code=CASE WHEN v_attempt.authorized_at IS NULL THEN 'PREPARATION_INTERRUPTED' ELSE 'RESULT_UNKNOWN' END,current_activity='El último intento requiere revisión.' WHERE id=v_device.id;
  UPDATE facebook_deliveries SET active_attempt_id=NULL WHERE id=v_job.id;
  RETURN jsonb_build_object('saved',true,'retired',true);
 END IF;
 IF p_operation='progress' THEN
  IF v_attempt.authorized_at IS NULL THEN
   IF v_attempt.lease_expires_at<v_now OR v_attempt.started_at+interval '10 minutes'<v_now THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
   v_lease:=least(v_now+interval '2 minutes',v_attempt.started_at+interval '10 minutes');
   UPDATE facebook_delivery_attempts SET lease_expires_at=v_lease WHERE id=p_attempt;
  END IF;
  UPDATE facebook_deliveries SET message=left(p_data->>'message',300),updated_at=v_now WHERE id=v_job.id;
  UPDATE facebook_devices SET current_activity=left(p_data->>'message',300) WHERE id=v_device.id;
  RETURN jsonb_build_object('saved',true);
 END IF;
 IF p_operation='checkpoint' THEN
  IF v_attempt.authorized_at IS NOT NULL THEN RETURN jsonb_build_object('authorized',false,'phase','authorized_before'); END IF;
  IF NOT v_device.queue_enabled THEN RAISE EXCEPTION 'QUEUE_PAUSED'; END IF;
  IF v_attempt.lease_expires_at<v_now OR v_attempt.started_at+interval '10 minutes'<v_now THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
  SELECT * INTO v_pub FROM facebook_publications WHERE id=v_job.publication_id;
  IF NOT facebook_product_allowed(v_pub.approved_by,v_pub.product_id,true) THEN RAISE EXCEPTION 'DEVICE_PERMISSION_REVOKED'; END IF;
  PERFORM facebook_assert_recovery_clear(v_job.id);
  UPDATE facebook_delivery_attempts SET authorized_at=v_now WHERE id=p_attempt;
  UPDATE facebook_deliveries SET submitted_at=v_now,updated_at=v_now WHERE id=v_job.id;
  PERFORM facebook_attempt_event(p_attempt,'checkpoint','{}','checkpoint');
  RETURN jsonb_build_object('authorized',true,'phase','authorized_now');
 END IF;
 RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED';
END; $$;
REVOKE ALL ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) TO anon,authenticated;

CREATE FUNCTION refresh_facebook_delivery_states() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_attempt facebook_delivery_attempts; v_count integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'stock','read') THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 FOR v_job IN SELECT d.* FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
 WHERE p.user_id=get_owner_uid(auth.uid()) AND d.status='running' ORDER BY d.id FOR UPDATE OF d SKIP LOCKED LOOP
  IF v_job.active_attempt_id IS NULL THEN
   IF v_job.claimed_at<now()-interval '5 minutes' THEN UPDATE facebook_deliveries SET status='attention',message='Ejecución interrumpida; revisá el resultado.',updated_at=now() WHERE id=v_job.id; END IF;
   CONTINUE;
  END IF;
  SELECT * INTO v_attempt FROM facebook_delivery_attempts WHERE id=v_job.active_attempt_id FOR UPDATE;
  IF (v_attempt.authorized_at IS NULL AND v_attempt.lease_expires_at<now()) OR v_attempt.authorized_at<now()-interval '2 minutes' THEN
   UPDATE facebook_delivery_attempts SET finished_at=now(),outcome=CASE WHEN authorized_at IS NULL THEN 'interrupted' ELSE 'unknown' END WHERE id=v_attempt.id;
   UPDATE facebook_deliveries SET status='attention',active_attempt_id=NULL,message='Ejecución interrumpida; revisá el resultado.',updated_at=now() WHERE id=v_job.id;
   v_count:=v_count+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('expired_attempts',v_count);
END; $$;
REVOKE ALL ON FUNCTION refresh_facebook_delivery_states() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION refresh_facebook_delivery_states() TO authenticated;

-- Preserve the proven approval/URL/permission guards from 0052/0053. One public signature only.
ALTER FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) RENAME TO approve_facebook_publication_before_attempts;
REVOKE ALL ON FUNCTION approve_facebook_publication_before_attempts(uuid,uuid,jsonb,uuid[],boolean,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION approve_facebook_publication(p_product uuid,p_intent uuid,p_content jsonb,p_groups uuid[],p_marketplace boolean,p_repeat_of uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT facebook_product_allowed(auth.uid(),p_product,true) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(get_owner_uid(auth.uid())::text||p_product::text,0));
 IF EXISTS(SELECT 1 FROM facebook_publications WHERE user_id=get_owner_uid(auth.uid()) AND intent_key=p_intent) THEN RETURN approve_facebook_publication_before_attempts(p_product,p_intent,p_content,p_groups,p_marketplace,p_repeat_of); END IF;
 IF EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE p.user_id=get_owner_uid(auth.uid()) AND p.product_id=p_product AND d.recovery_required
 AND ((p_marketplace AND d.destination->>'mechanism'='marketplace') OR facebook_group_key(d.destination->>'url') IN(SELECT facebook_group_key(url) FROM facebook_groups WHERE id=ANY(p_groups) AND user_id=get_owner_uid(auth.uid())))) THEN RAISE EXCEPTION 'RECOVERY_REQUIRED'; END IF;
 RETURN approve_facebook_publication_before_attempts(p_product,p_intent,p_content,p_groups,p_marketplace,p_repeat_of);
END; $$;
REVOKE ALL ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) TO authenticated;

ALTER FUNCTION retry_facebook_preparation(uuid) RENAME TO retry_facebook_preparation_before_attempts;
REVOKE ALL ON FUNCTION retry_facebook_preparation_before_attempts(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION retry_facebook_preparation(p_delivery uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=p_delivery AND facebook_product_allowed(auth.uid(),p.product_id,true)) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 PERFORM facebook_assert_recovery_clear(p_delivery);
 IF EXISTS(SELECT 1 FROM facebook_delivery_attempts WHERE delivery_id=p_delivery AND finished_at IS NULL) THEN RAISE EXCEPTION 'ATTEMPT_RECOVERY_REQUIRED'; END IF;
 PERFORM retry_facebook_preparation_before_attempts(p_delivery);
END; $$;
REVOKE ALL ON FUNCTION retry_facebook_preparation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION retry_facebook_preparation(uuid) TO authenticated;
ALTER FUNCTION resolve_facebook_delivery(uuid,text,text,jsonb) RENAME TO resolve_facebook_delivery_before_attempts;
REVOKE ALL ON FUNCTION resolve_facebook_delivery_before_attempts(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION resolve_facebook_delivery(p_delivery uuid,p_decision text,p_url text DEFAULT NULL,p_fields jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=p_delivery AND facebook_product_allowed(auth.uid(),p.product_id,true)) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 PERFORM facebook_assert_recovery_clear(p_delivery);
 IF EXISTS(SELECT 1 FROM facebook_delivery_attempts WHERE delivery_id=p_delivery AND finished_at IS NULL) THEN RAISE EXCEPTION 'ATTEMPT_RECOVERY_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM facebook_deliveries WHERE id=p_delivery AND status='attention' AND submitted_at IS NULL AND evidence_url IS NULL) THEN RAISE EXCEPTION 'El envío pudo comenzar o ya se resolvió. Revisá su resultado'; END IF;
 IF p_decision IN ('existing','new') AND NOT EXISTS(SELECT 1 FROM facebook_deliveries WHERE id=p_delivery AND issue->>'kind'='marketplace_conflict') THEN RAISE EXCEPTION 'No hay un conflicto de anuncios para resolver'; END IF;
 PERFORM resolve_facebook_delivery_before_attempts(p_delivery,p_decision,p_url,p_fields);
END; $$;
REVOKE ALL ON FUNCTION resolve_facebook_delivery(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION resolve_facebook_delivery(uuid,text,text,jsonb) TO authenticated;
CREATE FUNCTION review_facebook_attempt(p_attempt uuid,p_decision text,p_url text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_pub facebook_publications;
BEGIN
 SELECT p.* INTO v_pub FROM facebook_publications p JOIN facebook_deliveries d ON d.publication_id=p.id JOIN facebook_delivery_attempts a ON a.delivery_id=d.id WHERE a.id=p_attempt;
 IF NOT FOUND OR NOT facebook_product_allowed(auth.uid(),v_pub.product_id,true) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_pub.user_id::text||v_pub.product_id::text,0));
 SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_delivery_attempts a ON a.delivery_id=d.id WHERE a.id=p_attempt FOR UPDATE OF d;
 IF NOT v_job.recovery_required AND (v_job.status<>'attention' OR v_job.submitted_at IS NULL) THEN RAISE EXCEPTION 'El resultado no requiere revisión'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('found','not_found') OR (p_decision='found' AND NOT facebook_valid_evidence_url(p_url,v_job.destination)) OR (p_decision='not_found' AND p_url IS NOT NULL) THEN RAISE EXCEPTION 'Decisión inválida'; END IF;
 INSERT INTO facebook_delivery_reviews(delivery_id,reviewed_by,decision,evidence_url) VALUES(v_job.id,auth.uid(),p_decision,p_url);
 PERFORM facebook_attempt_event(p_attempt,'review',jsonb_build_object('decision',p_decision,'url',p_url,'actor',auth.uid()),'review-'||gen_random_uuid()::text);
 UPDATE facebook_delivery_attempts SET finished_at=coalesce(finished_at,now()),outcome=coalesce(outcome,'unknown') WHERE id=p_attempt;
 UPDATE facebook_deliveries SET recovery_required=false,active_attempt_id=NULL,updated_at=now(),
 status=CASE WHEN status IN ('submitted','published','pending_approval') THEN status WHEN p_decision='found' THEN 'submitted' ELSE 'cancelled' END,
 evidence_url=CASE WHEN status IN ('submitted','published','pending_approval') THEN evidence_url ELSE p_url END WHERE id=v_job.id;
END; $$;
REVOKE ALL ON FUNCTION review_facebook_attempt(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION review_facebook_attempt(uuid,text,text) TO authenticated;

COMMIT;

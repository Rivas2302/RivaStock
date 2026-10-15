BEGIN;
CREATE FUNCTION facebook_validate_issue(p_issue jsonb) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE item jsonb; field jsonb; option jsonb;
BEGIN
 IF jsonb_typeof(p_issue) IS DISTINCT FROM 'object' OR octet_length(p_issue::text)>24000
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_issue) k WHERE k NOT IN ('kind','message','candidates','fields')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF jsonb_typeof(p_issue->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(p_issue->'message') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF p_issue ? 'candidates' THEN
  IF jsonb_typeof(p_issue->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_issue->'candidates')>20 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_issue->'candidates') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
   IF jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR EXISTS(SELECT 1 FROM jsonb_each(item) v WHERE v.key IN ('summary','status','url') AND jsonb_typeof(v.value) NOT IN ('string','null')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('title','summary','status','url')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  END LOOP;
 END IF;
 IF p_issue ? 'fields' THEN
  IF jsonb_typeof(p_issue->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_issue->'fields')>12 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(p_issue->'fields') LOOP
   IF jsonb_typeof(field) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
   IF jsonb_typeof(field->'label') IS DISTINCT FROM 'string' OR (field ? 'supported' AND jsonb_typeof(field->'supported') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(field) k WHERE k NOT IN ('label','supported','options')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
   IF field ? 'options' AND jsonb_typeof(field->'options')<>'null' THEN
    IF jsonb_typeof(field->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(field->'options')>60 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
    FOR option IN SELECT value FROM jsonb_array_elements(field->'options') LOOP
     IF jsonb_typeof(option) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
     IF jsonb_typeof(option->'value') IS DISTINCT FROM 'string' OR jsonb_typeof(option->'label') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_object_keys(option) k WHERE k NOT IN ('value','label')) OR length(option->>'value')>1000 OR length(option->>'label')>160 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
    END LOOP;
   END IF;
  END LOOP;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION facebook_validate_issue(jsonb) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) RENAME TO facebook_worker_v2_validated_state;
REVOKE ALL ON FUNCTION facebook_worker_v2_validated_state(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_worker_v2(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE allowed text[]; result jsonb;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 allowed:=CASE p_operation WHEN 'heartbeat' THEN ARRAY['status','version','capabilities'] WHEN 'claim' THEN ARRAY['claimKey']
 WHEN 'queue_state' THEN ARRAY['status'] WHEN 'progress' THEN ARRAY['message'] WHEN 'attention' THEN ARRAY['message']
 WHEN 'issue' THEN ARRAY['issue','message'] WHEN 'result' THEN ARRAY['status','url','message'] ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT(k=ANY(allowed))) OR octet_length(p_data::text)>30000
 OR length(p_data->>'message')>1000 OR length(p_data->>'version')>40 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_data) v WHERE v.key IN ('message','url','status','version','claimKey') AND jsonb_typeof(v.value) NOT IN ('string','null')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF p_data ? 'capabilities' THEN
  IF jsonb_typeof(p_data->'capabilities') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'capabilities')>10 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'capabilities') c WHERE jsonb_typeof(c)<>'string' OR length(c#>>'{}')>40) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 END IF;
 IF p_operation='issue' THEN PERFORM facebook_validate_issue(p_data->'issue'); END IF;
 result:=facebook_worker_v2_validated_state(p_token,p_operation,p_delivery,p_attempt,p_data);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) TO anon,authenticated;

-- A human review must not bypass the explicit contradiction review contract.
ALTER FUNCTION review_facebook_delivery(uuid,text,text) RENAME TO review_facebook_delivery_before_attempts;
REVOKE ALL ON FUNCTION review_facebook_delivery_before_attempts(uuid,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION review_facebook_delivery(p_delivery uuid,p_decision text,p_url text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE attempt uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=p_delivery AND facebook_product_allowed(auth.uid(),p.product_id,true)) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 IF EXISTS(SELECT 1 FROM facebook_deliveries WHERE id=p_delivery AND recovery_required) THEN RAISE EXCEPTION 'RECOVERY_REQUIRED'; END IF;
 SELECT id INTO attempt FROM facebook_delivery_attempts WHERE delivery_id=p_delivery ORDER BY started_at DESC,id DESC LIMIT 1;
 IF attempt IS NOT NULL THEN PERFORM review_facebook_attempt(attempt,p_decision,p_url);
 ELSE PERFORM review_facebook_delivery_before_attempts(p_delivery,p_decision,p_url); END IF;
END; $$;
REVOKE ALL ON FUNCTION review_facebook_delivery(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION review_facebook_delivery(uuid,text,text) TO authenticated;

-- Retire old authorized journals without trusting their old result detector.
ALTER FUNCTION facebook_worker(text,text,uuid,text,text,text) RENAME TO facebook_worker_before_final_gate;
REVOKE ALL ON FUNCTION facebook_worker_before_final_gate(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_job facebook_deliveries; v_pub facebook_publications; v_attempt uuid;
BEGIN
 IF p_operation='result' AND p_delivery IS NOT NULL THEN
  SELECT p.* INTO v_pub FROM facebook_publications p JOIN facebook_deliveries d ON d.publication_id=p.id WHERE d.id=p_delivery;
  IF FOUND THEN PERFORM pg_advisory_xact_lock(hashtextextended(v_pub.user_id::text||v_pub.product_id::text,0)); END IF;
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets secrets ON secrets.device_id=d.id
   WHERE d.revoked_at IS NULL AND secrets.token_expires_at>now() AND secrets.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE OF d;
  IF NOT FOUND OR NOT has_permission(v_device.user_id,'config','write') THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=p_delivery AND d.device_id=v_device.id AND p.user_id=v_device.user_id FOR UPDATE OF d;
  IF FOUND AND v_job.submitted_at IS NOT NULL AND coalesce((SELECT required_protocol FROM facebook_worker_policy WHERE user_id=v_device.user_id),1)>=2
   AND NOT EXISTS(SELECT 1 FROM facebook_delivery_attempts WHERE delivery_id=v_job.id AND last_error_code IS DISTINCT FROM 'LEGACY_RESULT_UNVERIFIED') THEN
   IF coalesce(p_status,'') NOT IN ('submitted','published','pending_approval') OR (p_url IS NULL AND p_status<>'pending_approval') OR (p_url IS NOT NULL AND NOT facebook_valid_evidence_url(p_url,v_job.destination)) THEN RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID'; END IF;
   IF EXISTS(SELECT 1 FROM facebook_delivery_attempt_events e JOIN facebook_delivery_attempts a ON a.id=e.attempt_id WHERE a.delivery_id=v_job.id AND a.device_id=v_device.id AND e.idempotency_key='legacy-result-'||coalesce(p_url,'pending')) THEN RETURN jsonb_build_object('saved',true,'reviewed',true,'retired',true); END IF;
   INSERT INTO facebook_delivery_attempts(delivery_id,device_id,claim_key,authorized_at,finished_at,outcome,last_error_code)
    VALUES(v_job.id,v_device.id,v_job.id,v_job.submitted_at,now(),'unknown','LEGACY_RESULT_UNVERIFIED') ON CONFLICT(device_id,claim_key) DO UPDATE SET last_error_code='LEGACY_RESULT_UNVERIFIED' RETURNING id INTO v_attempt;
   PERFORM facebook_attempt_event(v_attempt,'result',jsonb_build_object('status',p_status,'url',p_url),'legacy-result-'||coalesce(p_url,'pending'));
   UPDATE facebook_deliveries SET status=CASE WHEN status IN ('submitted','published','pending_approval','cancelled') THEN status ELSE 'attention' END,
    recovery_required=true,message='Llegó un resultado de una extensión anterior. Revisá su evidencia antes de otro envío.',updated_at=now() WHERE id=v_job.id;
   RETURN jsonb_build_object('saved',true,'reviewed',true,'retired',true);
  END IF;
 END IF;
 RETURN facebook_worker_before_final_gate(p_token,p_operation,p_delivery,p_message,p_status,p_url);
END; $$;
REVOKE ALL ON FUNCTION facebook_worker(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker(text,text,uuid,text,text,text) TO anon,authenticated;
COMMIT;

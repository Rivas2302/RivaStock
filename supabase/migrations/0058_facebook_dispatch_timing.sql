BEGIN;
ALTER TABLE facebook_deliveries ADD COLUMN execution_timing jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER FUNCTION facebook_worker(text,text,uuid,text,text,text) RENAME TO facebook_worker_before_timing;
REVOKE ALL ON FUNCTION facebook_worker_before_timing(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_data jsonb; v_job facebook_deliveries; v_approved timestamptz;
BEGIN
  IF p_operation='claim' THEN
    v_data:=facebook_worker_before_timing(p_token,p_operation,p_delivery,p_message,p_status,p_url);
    IF v_data->>'id' IS NOT NULL THEN UPDATE facebook_deliveries SET execution_timing='{}'::jsonb WHERE id=(v_data->>'id')::uuid; END IF;
    RETURN v_data;
  END IF;
  IF p_operation='checkpoint' THEN
    PERFORM facebook_worker_before_timing(p_token,'heartbeat');
    SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    IF NOT v_device.queue_enabled THEN RAISE EXCEPTION 'Cola pausada. No se autorizó el envío'; END IF;
  END IF;
  IF p_operation<>'latency' THEN RETURN facebook_worker_before_timing(p_token,p_operation,p_delivery,p_message,p_status,p_url); END IF;
  PERFORM facebook_worker_before_timing(p_token,'heartbeat');
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF length(p_message)>4000 THEN RAISE EXCEPTION 'Medición demasiado extensa'; END IF;
  v_data:=p_message::jsonb;
  IF jsonb_typeof(v_data) IS DISTINCT FROM 'object' OR coalesce(v_data->>'source','') NOT IN ('local','alarm','drain','startup') OR EXISTS(SELECT 1 FROM jsonb_each(v_data) e WHERE e.key NOT IN ('source','receivedAt','receipt_to_claim_ms','claim_rpc_ms','receipt_to_preparation_ms','photos_ms','navigation_ms','preparation_ms')) THEN RAISE EXCEPTION 'Medición inválida'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(v_data) e WHERE e.key LIKE '%_ms' AND (jsonb_typeof(e.value)<>'number' OR (e.value::text)::numeric NOT BETWEEN 0 AND 86400000)) THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=p_delivery AND d.device_id=v_device.id AND p.user_id=v_device.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envío no asignado a esta PC'; END IF;
  SELECT approved_at INTO v_approved FROM facebook_publications WHERE id=v_job.publication_id;
  UPDATE facebook_deliveries SET execution_timing=execution_timing||v_data||jsonb_build_object('approval_to_claim_ms',greatest(0,extract(epoch FROM (v_job.claimed_at-v_approved))*1000)) WHERE id=p_delivery;
  RETURN jsonb_build_object('saved',true);
END;
$$;
REVOKE ALL ON FUNCTION facebook_worker(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker(text,text,uuid,text,text,text) TO anon,authenticated;

CREATE FUNCTION request_facebook_groups_if_due(p_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_sync facebook_group_sync;
BEGIN
  PERFORM facebook_worker(p_token,'heartbeat');
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF NOT pg_try_advisory_xact_lock(hashtextextended('facebook-group-maintenance:'||v_device.user_id::text,0)) THEN RETURN NULL; END IF;
  SELECT * INTO v_sync FROM facebook_group_sync WHERE user_id=v_device.user_id FOR UPDATE;
  IF FOUND AND (v_sync.status IN ('requested','running') OR coalesce(v_sync.finished_at,v_sync.requested_at)>now()-CASE WHEN v_sync.status='error' THEN interval '1 hour' ELSE interval '24 hours' END) THEN RETURN NULL; END IF;
  RETURN request_facebook_groups_from_device(p_token);
END;
$$;
REVOKE ALL ON FUNCTION request_facebook_groups_if_due(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_facebook_groups_if_due(text) TO anon,authenticated;
COMMIT;

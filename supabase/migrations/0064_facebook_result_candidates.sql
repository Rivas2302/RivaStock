BEGIN;

-- Extend type CHECK to include candidate events.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid='facebook_delivery_attempt_events'::regclass
  AND contype='c'
  AND pg_get_constraintdef(oid) ILIKE '%type%IN%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE facebook_delivery_attempt_events DROP CONSTRAINT %I', cname);
  END IF;
END; $$;
ALTER TABLE facebook_delivery_attempt_events
  ADD CONSTRAINT facebook_delivery_attempt_events_type_check
  CHECK (type IN ('claim','progress','checkpoint','authorize','submit','result','attention','issue','recover','review','contradiction','retire','candidate'));

-- Replace the public wrapper to add: capability gate on claim, features on
-- heartbeat, and candidate event on attention with candidateUrl.
CREATE OR REPLACE FUNCTION facebook_worker_v2(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  allowed text[];
  result jsonb;
  v_dev_cap jsonb;
  v_cand_url text;
  v_auth_at timestamptz;
  v_dest jsonb;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 allowed:=CASE p_operation
   WHEN 'heartbeat' THEN ARRAY['status','version','capabilities']
   WHEN 'claim'     THEN ARRAY['claimKey']
   WHEN 'queue_state' THEN ARRAY['status']
   WHEN 'progress'  THEN ARRAY['message']
   WHEN 'attention' THEN ARRAY['message','candidateUrl']
   WHEN 'issue'     THEN ARRAY['issue','message']
   WHEN 'result'    THEN ARRAY['status','url','message']
   ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT(k=ANY(allowed))) OR octet_length(p_data::text)>30000
 OR length(p_data->>'message')>1000 OR length(p_data->>'version')>40 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_data) v WHERE v.key IN ('message','url','status','version','claimKey','candidateUrl') AND jsonb_typeof(v.value) NOT IN ('string','null')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF p_data ? 'capabilities' THEN
  IF jsonb_typeof(p_data->'capabilities') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'capabilities')>10 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'capabilities') c WHERE jsonb_typeof(c)<>'string' OR length(c#>>'{}')>40) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 END IF;
 IF p_operation='issue' THEN PERFORM facebook_validate_issue(p_data->'issue'); END IF;

 -- Capability gate: a device without result-candidates cannot claim new work.
 IF p_operation='claim' THEN
  SELECT d.capabilities INTO v_dev_cap
  FROM facebook_devices d
  JOIN facebook_device_secrets s ON s.device_id=d.id
  WHERE d.revoked_at IS NULL
  AND s.token_expires_at > now()
  AND s.token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF FOUND AND (v_dev_cap IS NULL OR NOT (v_dev_cap @> '["result-candidates"]'::jsonb)) THEN
    RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED';
  END IF;
 END IF;

 result:=facebook_worker_v2_validated_state(p_token,p_operation,p_delivery,p_attempt,p_data);

 -- Announce the candidate feature in every heartbeat response.
 IF p_operation='heartbeat' THEN
  result := result || jsonb_build_object('features', jsonb_build_array('result-candidates'));
 END IF;

 -- Save candidate event when attention carries a candidateUrl.
 IF p_operation='attention' AND p_data->>'candidateUrl' IS NOT NULL AND p_attempt IS NOT NULL THEN
  v_cand_url := p_data->>'candidateUrl';
  SELECT a.authorized_at, d.destination
  INTO v_auth_at, v_dest
  FROM facebook_delivery_attempts a
  JOIN facebook_deliveries d ON d.id=a.delivery_id
  WHERE a.id=p_attempt;
  IF FOUND AND v_auth_at IS NOT NULL AND facebook_valid_evidence_url(v_cand_url, v_dest) THEN
    PERFORM facebook_attempt_event(p_attempt,'candidate',jsonb_build_object('url',v_cand_url),'candidate-'||v_cand_url);
  END IF;
 END IF;

 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) TO anon,authenticated;

COMMIT;

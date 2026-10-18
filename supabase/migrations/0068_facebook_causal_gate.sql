BEGIN;

-- One post or listing identifies a single delivery per owner, in any URL form
-- (/posts/ID and /permalink/ID name the same post).
CREATE FUNCTION facebook_evidence_in_use(p_owner uuid,p_delivery uuid,p_url text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce((regexp_match(coalesce(p_url,''),'/(posts|permalink|item)/([0-9]+)/?$'))[2] IS NOT NULL AND EXISTS(
  SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
  WHERE p.user_id=p_owner AND d.id<>p_delivery AND d.evidence_url IS NOT NULL
  AND (regexp_match(d.evidence_url,'/(posts|permalink|item)/([0-9]+)/?$'))[2]=(regexp_match(p_url,'/(posts|permalink|item)/([0-9]+)/?$'))[2]
  AND (d.evidence_url LIKE '%/marketplace/%')=(p_url LIKE '%/marketplace/%')),false);
$$;
REVOKE ALL ON FUNCTION facebook_evidence_in_use(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

-- Replace the public wrapper to add, on top of 0065:
-- * claim requires causal-results-v2, so extension builds that promoted feed
--   matches or rewrote other groups' URLs (0.5.5/0.5.6) stop taking new work;
-- * a result resent with the same status and URL is idempotent even when its
--   message differs, instead of raising a false contradiction;
-- * one post or listing can be the evidence of a single delivery per owner.
CREATE OR REPLACE FUNCTION facebook_worker_v2(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  allowed text[];
  result jsonb;
  v_dev_cap jsonb;
  v_cand_url text;
  v_auth_at timestamptz;
  v_dest jsonb;
  v_receipt jsonb;
  v_rejected text;
  v_outcome text;
  v_evidence jsonb;
  v_owner uuid;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 allowed:=CASE p_operation
   WHEN 'heartbeat' THEN ARRAY['status','version','capabilities']
   WHEN 'claim'     THEN ARRAY['claimKey']
   WHEN 'queue_state' THEN ARRAY['status']
   WHEN 'progress'  THEN ARRAY['message']
   WHEN 'attention' THEN ARRAY['message','candidateUrl','receipt','rejectedEvidence']
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

 -- Capability gate: only a device with causal-only results can claim new work.
 IF p_operation='claim' THEN
  SELECT d.capabilities INTO v_dev_cap
  FROM facebook_devices d
  JOIN facebook_device_secrets s ON s.device_id=d.id
  WHERE d.revoked_at IS NULL
  AND s.token_expires_at > now()
  AND s.token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF FOUND AND (v_dev_cap IS NULL OR NOT (v_dev_cap @> '["result-candidates","causal-results-v2"]'::jsonb)) THEN
    RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED';
  END IF;
 END IF;

 -- Result guards, scoped to an attempt owned by this device token.
 IF p_operation='result' AND p_attempt IS NOT NULL THEN
  SELECT a.outcome, a.evidence, p.user_id INTO v_outcome, v_evidence, v_owner
  FROM facebook_delivery_attempts a
  JOIN facebook_device_secrets s ON s.device_id=a.device_id
  JOIN facebook_deliveries d ON d.id=a.delivery_id
  JOIN facebook_publications p ON p.id=d.publication_id
  WHERE a.id=p_attempt AND a.delivery_id=p_delivery
  AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF FOUND THEN
   IF v_outcome IS NOT NULL AND v_outcome=p_data->>'status' AND v_evidence->>'url' IS NOT DISTINCT FROM p_data->>'url' THEN
    RETURN jsonb_build_object('saved',true,'retired',true);
   END IF;
   IF facebook_evidence_in_use(v_owner,p_delivery,p_data->>'url') THEN
    RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID';
   END IF;
  END IF;
 END IF;

 result:=facebook_worker_v2_validated_state(p_token,p_operation,p_delivery,p_attempt,p_data);

 IF p_operation='heartbeat' THEN
  result := result || jsonb_build_object('features', jsonb_build_array('result-candidates','evidence-receipts','causal-results-v2'));
 END IF;

 -- Evidence attached to attention is recorded only for an authorized attempt.
 -- Malformed evidence is dropped without failing attention: the journal must
 -- always be able to retire, otherwise the device queue stalls.
 IF p_operation='attention' AND p_attempt IS NOT NULL
 AND (p_data ? 'candidateUrl' OR p_data ? 'receipt' OR p_data ? 'rejectedEvidence') THEN
  SELECT a.authorized_at, d.destination
  INTO v_auth_at, v_dest
  FROM facebook_delivery_attempts a
  JOIN facebook_deliveries d ON d.id=a.delivery_id
  WHERE a.id=p_attempt;
  IF FOUND AND v_auth_at IS NOT NULL THEN
    v_cand_url := p_data->>'candidateUrl';
    IF v_cand_url IS NOT NULL AND facebook_valid_evidence_url(v_cand_url, v_dest) THEN
      PERFORM facebook_attempt_event(p_attempt,'candidate',jsonb_build_object('url',v_cand_url),'candidate-'||v_cand_url);
    END IF;

    v_receipt := p_data->'receipt';
    IF jsonb_typeof(v_receipt)='object'
    AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v_receipt) k WHERE k NOT IN ('status','message'))
    AND coalesce(v_receipt->>'status','') IN ('submitted','published','pending_approval')
    AND length(coalesce(v_receipt->>'message',''))<=1000 THEN
      PERFORM facebook_attempt_event(p_attempt,'receipt',v_receipt,'receipt-'||encode(sha256(convert_to(v_receipt::text,'UTF8')),'hex'));
    END IF;

    -- A rejected capture keeps its raw URL: it failed the destination contract,
    -- so it is preserved for review, never validated into evidence.
    IF jsonb_typeof(p_data->'rejectedEvidence')='string' THEN
      v_rejected := p_data->>'rejectedEvidence';
      IF v_rejected ~ '^https://www\.facebook\.com/(marketplace/item/[0-9]+|groups/[A-Za-z0-9._-]+/(posts|permalink)/[0-9]+)/?$' THEN
        PERFORM facebook_attempt_event(p_attempt,'evidence_rejected',jsonb_build_object('url',v_rejected),'evidence-rejected-'||v_rejected);
      END IF;
    END IF;
  END IF;
 END IF;

 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) TO anon,authenticated;

COMMIT;

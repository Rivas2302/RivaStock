BEGIN;

-- Keep a compact, verified identifier for the owned post/listing. Tracking
-- results are fetched by the same device that captured the pending result.
ALTER TABLE facebook_delivery_attempts
  ADD COLUMN pending_post_id text CHECK (pending_post_id IS NULL OR pending_post_id ~ '^[0-9]{1,30}$'),
  ADD COLUMN tracking_checked_at timestamptz;
ALTER TABLE facebook_delivery_attempts DROP CONSTRAINT facebook_delivery_attempts_outcome_check;
ALTER TABLE facebook_delivery_attempts ADD CONSTRAINT facebook_delivery_attempts_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('submitted','published','pending_approval','not_approved','interrupted','unknown','retired'));
ALTER TABLE facebook_delivery_attempt_events DROP CONSTRAINT facebook_delivery_attempt_events_type_check;
ALTER TABLE facebook_delivery_attempt_events ADD CONSTRAINT facebook_delivery_attempt_events_type_check
  CHECK (type IN ('claim','progress','checkpoint','authorize','submit','result','attention','issue','recover','review','contradiction','retire','candidate','receipt','evidence_rejected','tracking'));

-- One post or listing identifies a single delivery per owner, in any URL form
-- (/posts/ID and /permalink/ID name the same post).
CREATE OR REPLACE FUNCTION facebook_evidence_in_use(p_owner uuid,p_delivery uuid,p_url text) RETURNS boolean
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
-- * one post or listing can be the evidence of a single delivery per owner;
-- * pending results can be tracked only from the device that captured them.
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
  v_post_id text;
  v_track_status text;
  v_track_url text;
  v_track_key text;
  v_attempt facebook_delivery_attempts;
  v_device_id uuid;
  v_device_user uuid;
  v_delivery_status text;
  v_submitted_at timestamptz;
  v_items jsonb;
  v_now timestamptz:=clock_timestamp();
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 allowed:=CASE p_operation
   WHEN 'heartbeat' THEN ARRAY['status','version','capabilities']
   WHEN 'claim'     THEN ARRAY['claimKey']
   WHEN 'queue_state' THEN ARRAY['status']
   WHEN 'progress'  THEN ARRAY['message']
   WHEN 'attention' THEN ARRAY['message','candidateUrl','receipt','rejectedEvidence']
   WHEN 'issue'     THEN ARRAY['issue','message']
   WHEN 'result'    THEN ARRAY['status','url','message','pendingPostId']
   WHEN 'track'     THEN ARRAY['status','url','message','pendingPostId']
   ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT(k=ANY(allowed))) OR octet_length(p_data::text)>30000
 OR length(p_data->>'message')>1000 OR length(p_data->>'version')>40 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_data) v WHERE v.key IN ('message','url','status','version','claimKey','candidateUrl','pendingPostId') AND jsonb_typeof(v.value) NOT IN ('string','null')) THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
 IF p_operation='result' AND p_data ? 'pendingPostId'
  AND (p_data->>'pendingPostId' !~ '^[0-9]{1,30}$' OR p_data->>'status'<>'pending_approval') THEN RAISE EXCEPTION 'RESULT_INVALID'; END IF;
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
  IF FOUND AND (v_dev_cap IS NULL OR NOT (v_dev_cap @> '["result-candidates","causal-results-v2","own-content-tracking"]'::jsonb)) THEN
    RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED';
  END IF;
 END IF;

 -- A tracking read is scoped to pending attempts owned by this device. The
 -- heartbeat path performs the normal credential, permission and lease refresh.
 IF p_operation='track' AND p_attempt IS NULL THEN
  IF p_delivery IS NOT NULL OR p_data<>'{}'::jsonb THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  PERFORM facebook_worker_v2_validated_state(p_token,'heartbeat',NULL,NULL,'{}'::jsonb);
  SELECT d.id,d.user_id,d.capabilities INTO v_device_id,v_device_user,v_dev_cap
   FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
   WHERE d.revoked_at IS NULL AND s.token_expires_at>now()
   AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF NOT FOUND OR v_dev_cap IS NULL OR NOT(v_dev_cap @> '["own-content-tracking"]'::jsonb) THEN RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED'; END IF;
  WITH candidates AS (
   SELECT a.id,a.delivery_id,a.pending_post_id,a.started_at
   FROM facebook_delivery_attempts a
   JOIN facebook_deliveries d ON d.id=a.delivery_id
   JOIN facebook_publications p ON p.id=d.publication_id
   WHERE a.device_id=v_device_id AND p.user_id=v_device_user
     AND a.outcome='pending_approval' AND a.finished_at IS NOT NULL
     AND a.pending_post_id IS NOT NULL
      AND d.status='pending_approval'
     AND (a.tracking_checked_at IS NULL OR a.tracking_checked_at<v_now-interval '2 minutes')
   ORDER BY a.tracking_checked_at NULLS FIRST,a.started_at
   FOR UPDATE OF a SKIP LOCKED LIMIT 10
  ), marked AS (
   UPDATE facebook_delivery_attempts a SET tracking_checked_at=v_now
   FROM candidates c WHERE a.id=c.id RETURNING a.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('deliveryId',c.delivery_id,'attemptId',c.id,
     'pendingPostId',c.pending_post_id,'destination',d.destination,'title',p.content->>'title')),'[]'::jsonb)
  INTO v_items FROM candidates c JOIN marked m ON m.id=c.id
  JOIN facebook_deliveries d ON d.id=c.delivery_id JOIN facebook_publications p ON p.id=d.publication_id;
  RETURN jsonb_build_object('items',v_items);
 END IF;

 -- Tracking updates are accepted only for the same numeric identifier and the
 -- same device that stored the pending result. They never re-authorize a click.
 IF p_operation='track' THEN
  IF p_attempt IS NULL OR p_delivery IS NULL OR p_data->>'pendingPostId' IS NULL
   OR p_data->>'pendingPostId' !~ '^[0-9]{1,30}$'
   OR coalesce(p_data->>'status','') NOT IN ('pending_approval','published','submitted','not_approved')
   OR length(coalesce(p_data->>'message',''))>1000 THEN RAISE EXCEPTION 'DIAGNOSTIC_INVALID'; END IF;
  PERFORM facebook_worker_v2_validated_state(p_token,'heartbeat',NULL,NULL,'{}'::jsonb);
  SELECT a.* INTO v_attempt FROM facebook_delivery_attempts a
   JOIN facebook_device_secrets s ON s.device_id=a.device_id
   WHERE a.id=p_attempt AND a.delivery_id=p_delivery
    AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
   FOR UPDATE OF a;
  IF NOT FOUND OR v_attempt.pending_post_id IS DISTINCT FROM p_data->>'pendingPostId' THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
  v_track_status:=p_data->>'status';v_track_url:=p_data->>'url';
  v_track_key:='tracking-'||encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=p_attempt AND idempotency_key=v_track_key) THEN
   RETURN jsonb_build_object('saved',true,'retired',v_track_status<>'pending_approval');
  END IF;
  IF v_attempt.outcome<>'pending_approval' OR v_attempt.finished_at IS NULL THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
  SELECT d.destination,d.status,d.submitted_at,p.user_id INTO v_dest,v_delivery_status,v_submitted_at,v_owner
   FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
   WHERE d.id=v_attempt.delivery_id AND d.id=p_delivery FOR UPDATE OF d;
  IF NOT FOUND OR v_submitted_at IS NULL OR v_delivery_status<>'pending_approval' THEN RAISE EXCEPTION 'ATTEMPT_STALE'; END IF;
  IF (v_dest->>'mechanism'='group_direct' AND NOT (
      (v_track_status='pending_approval' AND v_track_url IS NULL) OR
      (v_track_status='published' AND v_track_url IS NOT NULL AND v_track_url ~ ('/posts/'||v_attempt.pending_post_id||'/?$')) OR
      (v_track_status='not_approved' AND v_track_url IS NULL)))
    OR (v_dest->>'mechanism'='marketplace' AND NOT (
      (v_track_status IN ('pending_approval','submitted') AND v_track_url IS NOT NULL AND v_track_url ~ ('/marketplace/item/'||v_attempt.pending_post_id||'/?$')) OR
      (v_track_status='not_approved' AND v_track_url IS NULL)))
    OR (v_dest->>'mechanism' NOT IN ('group_direct','marketplace')) THEN RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID'; END IF;
  IF v_track_url IS NOT NULL AND NOT facebook_valid_evidence_url(v_track_url,v_dest) THEN RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID'; END IF;
  IF v_track_url IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
   IF facebook_evidence_in_use(v_owner,p_delivery,v_track_url) THEN RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID'; END IF;
  END IF;
  PERFORM facebook_attempt_event(p_attempt,'tracking',jsonb_build_object('status',v_track_status,'url',v_track_url,'pendingPostId',v_attempt.pending_post_id,'message',left(p_data->>'message',1000)),v_track_key);
  IF v_track_status='pending_approval' THEN
   UPDATE facebook_delivery_attempts SET evidence=p_data,tracking_checked_at=v_now WHERE id=p_attempt;
   UPDATE facebook_deliveries SET evidence_url=coalesce(v_track_url,evidence_url),message=left(p_data->>'message',1000),updated_at=v_now WHERE id=p_delivery;
  ELSIF v_track_status='not_approved' THEN
   UPDATE facebook_delivery_attempts SET outcome='not_approved',evidence=p_data,tracking_checked_at=v_now WHERE id=p_attempt;
   UPDATE facebook_deliveries SET status='attention',evidence_url=NULL,
    issue=jsonb_build_object('kind','facebook_not_approved','message',left(p_data->>'message',1000)),
    message=left(p_data->>'message',1000),updated_at=v_now WHERE id=p_delivery;
  ELSE
   UPDATE facebook_delivery_attempts SET outcome=v_track_status,evidence=p_data,tracking_checked_at=v_now WHERE id=p_attempt;
   UPDATE facebook_deliveries SET status=v_track_status,evidence_url=v_track_url,issue=NULL,
    message=left(p_data->>'message',1000),updated_at=v_now WHERE id=p_delivery;
  END IF;
  RETURN jsonb_build_object('saved',true,'retired',v_track_status<>'pending_approval');
 END IF;

 -- Result guards, scoped to an attempt owned by this device token.
 IF p_operation='result' AND p_attempt IS NOT NULL THEN
  SELECT a.outcome, a.evidence, p.user_id,a.pending_post_id INTO v_outcome, v_evidence, v_owner,v_post_id
  FROM facebook_delivery_attempts a
  JOIN facebook_device_secrets s ON s.device_id=a.device_id
  JOIN facebook_deliveries d ON d.id=a.delivery_id
  JOIN facebook_publications p ON p.id=d.publication_id
  WHERE a.id=p_attempt AND a.delivery_id=p_delivery
  AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF FOUND THEN
   IF v_outcome IS NOT NULL AND v_outcome=p_data->>'status' AND v_evidence->>'url' IS NOT DISTINCT FROM p_data->>'url'
    AND v_post_id IS NOT DISTINCT FROM p_data->>'pendingPostId' THEN
    RETURN jsonb_build_object('saved',true,'retired',true);
   END IF;
   IF facebook_evidence_in_use(v_owner,p_delivery,p_data->>'url') THEN
    RAISE EXCEPTION 'RESULT_EVIDENCE_INVALID';
   END IF;
  END IF;
 END IF;

 result:=facebook_worker_v2_validated_state(p_token,p_operation,p_delivery,p_attempt,p_data);

 IF p_operation='result' AND p_attempt IS NOT NULL AND p_data ? 'pendingPostId'
  AND p_data->>'status'='pending_approval' AND coalesce((result->>'saved')::boolean,false) THEN
  UPDATE facebook_delivery_attempts SET pending_post_id=p_data->>'pendingPostId',tracking_checked_at=NULL
   WHERE id=p_attempt AND outcome='pending_approval' AND finished_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM facebook_deliveries d WHERE d.id=p_delivery AND d.status='pending_approval');
 END IF;

 IF p_operation='heartbeat' THEN
  result := result || jsonb_build_object('features', jsonb_build_array('result-candidates','evidence-receipts','causal-results-v2','own-content-tracking'));
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

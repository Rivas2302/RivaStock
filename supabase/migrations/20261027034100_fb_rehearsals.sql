BEGIN;

CREATE TABLE public.fb_rehearsals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  destination jsonb NOT NULL CHECK (jsonb_typeof(destination) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'rehearsal_ok', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  device_id uuid REFERENCES public.facebook_devices(id) ON DELETE SET NULL,
  claim_key uuid,
  trace_id uuid REFERENCES public.fb_run_traces(id) ON DELETE SET NULL,
  error_step text CHECK (error_step IS NULL OR char_length(error_step) <= 160),
  result jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 20480),
  CONSTRAINT fb_rehearsals_status_timestamps CHECK (
    (status = 'pending' AND started_at IS NULL AND finished_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL)
    OR (status IN ('rehearsal_ok', 'failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL)
  )
);

CREATE INDEX fb_rehearsals_owner_created_idx
  ON public.fb_rehearsals (user_id, created_at DESC);
CREATE INDEX fb_rehearsals_pending_created_idx
  ON public.fb_rehearsals (created_at, id) WHERE status = 'pending';
CREATE INDEX fb_rehearsals_running_device_idx
  ON public.fb_rehearsals (device_id, started_at) WHERE status = 'running';
CREATE UNIQUE INDEX fb_rehearsals_claim_idx
  ON public.fb_rehearsals (user_id, device_id, claim_key) WHERE claim_key IS NOT NULL;
CREATE INDEX fb_rehearsals_trace_idx
  ON public.fb_rehearsals (trace_id) WHERE trace_id IS NOT NULL;

ALTER TABLE public.fb_rehearsals ENABLE ROW LEVEL SECURITY;
CREATE POLICY fb_rehearsals_owner_read
  ON public.fb_rehearsals FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.get_owner_uid((SELECT auth.uid())) = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.fb_rehearsals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fb_rehearsals TO authenticated;

CREATE FUNCTION public.request_facebook_rehearsal(
  p_product uuid,
  p_content jsonb,
  p_destination jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_destination jsonb;
  v_group facebook_groups%ROWTYPE;
  v_pending integer;
  v_id uuid;
BEGIN
  IF v_user IS NULL OR public.get_owner_uid(v_user) IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'OWNER_ONLY';
  END IF;
  IF p_content IS NULL OR jsonb_typeof(p_content) IS DISTINCT FROM 'object'
    OR octet_length(p_content::text) > 50000
    OR jsonb_typeof(p_content->'photos') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_content->'title') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_content->>'title')) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_content->'description') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_content->>'description')) NOT BETWEEN 1 AND 5000
    OR jsonb_typeof(p_content->'price') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_content->'location') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_content->>'location')) NOT BETWEEN 1 AND 160
    OR jsonb_typeof(p_content->'category') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_content->>'category')) NOT BETWEEN 1 AND 160
    OR coalesce(p_content->>'condition', '') NOT IN ('new', 'like_new', 'good', 'fair') THEN
    RAISE EXCEPTION 'REHEARSAL_CONTENT_INVALID';
  END IF;
  IF (p_content->>'price')::numeric NOT BETWEEN 0.01 AND 999999999 THEN
    RAISE EXCEPTION 'REHEARSAL_CONTENT_INVALID';
  END IF;
  IF jsonb_array_length(p_content->'photos') NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'REHEARSAL_CONTENT_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_content->'photos') AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
      OR char_length(item.value #>> '{}') > 2048
      OR (item.value #>> '{}') !~ '^https://'
  ) THEN
    RAISE EXCEPTION 'REHEARSAL_CONTENT_INVALID';
  END IF;
  IF jsonb_typeof(p_content->'groupText') IS NOT NULL
    AND (jsonb_typeof(p_content->'groupText') IS DISTINCT FROM 'string'
      OR char_length(p_content->>'groupText') > 6000) THEN
    RAISE EXCEPTION 'REHEARSAL_CONTENT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product AND user_id = v_user) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  IF p_destination IS NULL OR jsonb_typeof(p_destination) IS DISTINCT FROM 'object'
    OR octet_length(p_destination::text) > 4096 THEN
    RAISE EXCEPTION 'REHEARSAL_DESTINATION_INVALID';
  ELSIF p_destination->>'mechanism' = 'marketplace'
    AND p_destination->>'url' = 'https://www.facebook.com/marketplace/create/item' THEN
    v_destination := jsonb_build_object(
      'mechanism', 'marketplace',
      'name', 'Marketplace',
      'url', 'https://www.facebook.com/marketplace/create/item'
    );
  ELSIF p_destination->>'mechanism' = 'group_direct'
    AND p_destination->>'url' ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/?$' THEN
    SELECT * INTO v_group
    FROM public.facebook_groups
    WHERE user_id = v_user
      AND regexp_replace(url, '/$', '') = regexp_replace(p_destination->>'url', '/$', '')
    FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REHEARSAL_DESTINATION_INVALID'; END IF;
    v_destination := jsonb_build_object(
      'mechanism', 'group_direct', 'name', v_group.name, 'url', v_group.url
    );
  ELSE
    RAISE EXCEPTION 'REHEARSAL_DESTINATION_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  SELECT count(*)::integer INTO v_pending
  FROM public.fb_rehearsals
  WHERE user_id = v_user AND status IN ('pending', 'running');
  IF v_pending >= 3 THEN RAISE EXCEPTION 'REHEARSAL_LIMIT_REACHED'; END IF;

  INSERT INTO public.fb_rehearsals (user_id, product_id, content, destination)
  VALUES (v_user, p_product, p_content, v_destination)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_facebook_rehearsal(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_facebook_rehearsal(uuid, jsonb, jsonb) TO authenticated;

CREATE FUNCTION public.fb_trace_start_for_rehearsal(
  p_user_id uuid,
  p_device_id uuid,
  p_rehearsal_id uuid,
  p_mechanism text,
  p_extension_version text,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rehearsal public.fb_rehearsals%ROWTYPE;
  v_trace_id uuid;
BEGIN
  SELECT * INTO v_rehearsal
  FROM public.fb_rehearsals
  WHERE id = p_rehearsal_id AND user_id = p_user_id AND device_id = p_device_id
    AND destination->>'mechanism' = p_mechanism
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rehearsal does not belong to this active device'; END IF;
  IF v_rehearsal.trace_id IS NOT NULL THEN RETURN v_rehearsal.trace_id; END IF;
  IF v_rehearsal.status <> 'running' THEN RAISE EXCEPTION 'Rehearsal is not active'; END IF;

  v_trace_id := public.fb_trace_start(
    p_user_id, p_device_id, NULL, NULL, 'rehearsal', p_mechanism,
    p_extension_version, p_summary
  );
  UPDATE public.fb_rehearsals SET trace_id = v_trace_id WHERE id = p_rehearsal_id;
  RETURN v_trace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fb_trace_start_for_rehearsal(uuid, uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_trace_start_for_rehearsal(uuid, uuid, uuid, text, text, jsonb)
  TO service_role;

CREATE FUNCTION public.facebook_rehearsal_worker(
  p_token text,
  p_operation text,
  p_id uuid DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device_id uuid;
  v_user_id uuid;
  v_claim_key uuid;
  v_rehearsal public.fb_rehearsals%ROWTYPE;
  v_outcome text;
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text) > 25000 THEN
    RAISE EXCEPTION 'REHEARSAL_REQUEST_INVALID';
  END IF;
  SELECT device.id, device.user_id INTO v_device_id, v_user_id
  FROM public.facebook_devices device
  JOIN public.facebook_device_secrets secret ON secret.device_id = device.id
  WHERE device.revoked_at IS NULL
    AND secret.token_expires_at > now()
    AND secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    AND public.has_permission(device.user_id, 'config', 'write')
  FOR UPDATE OF device;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_REVOKED'; END IF;

  IF p_operation = 'claim' THEN
    IF p_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_data) AS item(key) WHERE item.key <> 'claimKey'
    ) OR coalesce(p_data->>'claimKey', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'REHEARSAL_REQUEST_INVALID';
    END IF;
    v_claim_key := (p_data->>'claimKey')::uuid;
    SELECT * INTO v_rehearsal
    FROM public.fb_rehearsals
    WHERE user_id = v_user_id AND device_id = v_device_id AND claim_key = v_claim_key
    FOR UPDATE;
    IF FOUND AND v_rehearsal.status <> 'running' THEN RETURN NULL; END IF;
    IF NOT FOUND THEN
      SELECT * INTO v_rehearsal
      FROM public.fb_rehearsals
      WHERE user_id = v_user_id AND status = 'pending'
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1;
      IF NOT FOUND THEN RETURN NULL; END IF;
      UPDATE public.fb_rehearsals
      SET status = 'running', started_at = now(), device_id = v_device_id, claim_key = v_claim_key
      WHERE id = v_rehearsal.id
      RETURNING * INTO v_rehearsal;
    END IF;
    RETURN jsonb_build_object(
      'id', v_rehearsal.id,
      'product_id', v_rehearsal.product_id,
      'content', v_rehearsal.content,
      'destination', v_rehearsal.destination,
      'trace_id', v_rehearsal.trace_id,
      'started_at', v_rehearsal.started_at
    );
  ELSIF p_operation = 'finish' THEN
    IF p_id IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_data) AS item(key)
      WHERE item.key NOT IN ('outcome', 'error_step', 'summary')
    ) OR coalesce(p_data->>'outcome', '') NOT IN ('rehearsal_ok', 'failed')
      OR (p_data ? 'error_step' AND (jsonb_typeof(p_data->'error_step') IS DISTINCT FROM 'string'
        OR char_length(p_data->>'error_step') > 160))
      OR (p_data ? 'summary' AND (jsonb_typeof(p_data->'summary') IS DISTINCT FROM 'object'
        OR octet_length((p_data->'summary')::text) > 20480)) THEN
      RAISE EXCEPTION 'REHEARSAL_REQUEST_INVALID';
    END IF;
    v_outcome := p_data->>'outcome';
    SELECT * INTO v_rehearsal
    FROM public.fb_rehearsals
    WHERE id = p_id AND user_id = v_user_id AND device_id = v_device_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REHEARSAL_STALE'; END IF;
    IF v_rehearsal.status = v_outcome AND v_rehearsal.finished_at IS NOT NULL THEN
      RETURN jsonb_build_object('saved', true, 'status', v_outcome, 'trace_id', v_rehearsal.trace_id);
    END IF;
    IF v_rehearsal.status <> 'running' THEN RAISE EXCEPTION 'REHEARSAL_STALE'; END IF;
    IF v_outcome = 'rehearsal_ok' AND v_rehearsal.trace_id IS NULL THEN
      RAISE EXCEPTION 'REHEARSAL_TRACE_MISSING';
    END IF;
    UPDATE public.fb_rehearsals
    SET status = v_outcome,
        finished_at = now(),
        error_step = CASE WHEN v_outcome = 'failed' THEN p_data->>'error_step' ELSE NULL END,
        result = coalesce(p_data->'summary', '{}'::jsonb)
    WHERE id = p_id;
    RETURN jsonb_build_object('saved', true, 'status', v_outcome, 'trace_id', v_rehearsal.trace_id);
  ELSE
    RAISE EXCEPTION 'REHEARSAL_REQUEST_INVALID';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.facebook_rehearsal_worker(text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facebook_rehearsal_worker(text, text, uuid, jsonb) TO anon, authenticated;

COMMIT;

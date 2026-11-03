BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('knowledge-cache', 'knowledge-cache', false, 52428800, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown', 'text/x-markdown',
  'image/png', 'image/jpeg', 'image/webp'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY knowledge_cache_objects_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge-cache'
    AND (storage.foldername(name))[1] = (SELECT public.knowledge_owner_for('read'))::text);

CREATE TABLE public.knowledge_file_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_id   uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'uploading', 'ready', 'failed', 'expired')),
  cache_path   text CHECK (cache_path IS NULL OR char_length(cache_path) <= 400),
  error        text CHECK (error IS NULL OR char_length(error) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz,
  ready_at     timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  FOREIGN KEY (user_id, version_id)
    REFERENCES public.knowledge_document_versions(user_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_file_requests_owner_status_idx
  ON public.knowledge_file_requests (user_id, status, created_at);
CREATE INDEX knowledge_file_requests_version_open_idx
  ON public.knowledge_file_requests (user_id, version_id, expires_at DESC)
  WHERE status IN ('pending', 'uploading', 'ready');
ALTER TABLE public.knowledge_file_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_file_requests_read ON public.knowledge_file_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
REVOKE ALL ON public.knowledge_file_requests FROM anon, authenticated;
GRANT SELECT ON public.knowledge_file_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_open_original(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
  v_version knowledge_document_versions%ROWTYPE;
  v_last_seen timestamptz;
  v_request knowledge_file_requests%ROWTYPE;
  v_open_count integer;
BEGIN
  SELECT * INTO v_version
  FROM knowledge_document_versions
  WHERE id = p_version_id AND user_id = v_owner;
  IF NOT FOUND OR v_version.storage_path IS NULL THEN
    RETURN jsonb_build_object('mode', 'missing');
  END IF;
  IF v_version.storage_location = 'missing' THEN
    RETURN jsonb_build_object('mode', 'missing');
  END IF;
  IF v_version.cloud_purged_at IS NULL THEN
    RETURN jsonb_build_object('mode', 'cloud', 'path', v_version.storage_path);
  END IF;

  SELECT max(last_seen_at) INTO v_last_seen
  FROM ai_bridge_devices
  WHERE user_id = v_owner AND revoked_at IS NULL;
  IF v_last_seen IS NULL OR v_last_seen < now() - interval '90 seconds' THEN
    RETURN jsonb_build_object('mode', 'offline', 'last_seen_at', v_last_seen);
  END IF;

  -- Serialize per owner so concurrent clicks cannot exceed the open-request cap.
  PERFORM 1 FROM profiles WHERE id = v_owner FOR UPDATE;
  SELECT * INTO v_request
  FROM knowledge_file_requests
  WHERE user_id = v_owner AND version_id = p_version_id
    AND status IN ('pending', 'uploading', 'ready') AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('mode', 'requested', 'request_id', v_request.id);
  END IF;

  SELECT count(*) INTO v_open_count
  FROM knowledge_file_requests
  WHERE user_id = v_owner AND status IN ('pending', 'uploading', 'ready') AND expires_at > now();
  IF v_open_count >= 10 THEN
    RAISE EXCEPTION 'Ya hay demasiados originales pendientes. Esperá a que termine una solicitud.';
  END IF;

  INSERT INTO knowledge_file_requests (user_id, version_id, requested_by)
  VALUES (v_owner, p_version_id, auth.uid())
  RETURNING * INTO v_request;
  RETURN jsonb_build_object('mode', 'requested', 'request_id', v_request.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_file_request_status(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
  v_request knowledge_file_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM knowledge_file_requests
  WHERE id = p_id AND user_id = v_owner;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF v_request.expires_at <= now()
    AND v_request.status IN ('pending', 'uploading', 'ready') THEN
    UPDATE knowledge_file_requests SET status = 'expired'
    WHERE id = p_id AND user_id = v_owner
    RETURNING * INTO v_request;
  END IF;
  RETURN jsonb_build_object(
    'status', v_request.status, 'cache_path', v_request.cache_path,
    'error', v_request.error, 'ready_at', v_request.ready_at,
    'expires_at', v_request.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_central_next_requests(
  p_owner uuid, p_worker uuid, p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF p_limit < 1 OR p_limit > 5 THEN RAISE EXCEPTION 'Límite de pedidos inválido'; END IF;

  UPDATE knowledge_file_requests
    SET status = 'expired', error = 'La solicitud venció.'
    WHERE user_id = p_owner AND expires_at <= now()
      AND status IN ('pending', 'uploading');
  UPDATE knowledge_file_requests
    SET status = 'pending', claimed_at = NULL
    WHERE user_id = p_owner AND status = 'uploading'
      AND claimed_at < now() - interval '5 minutes'
      AND expires_at > now();

  WITH candidates AS (
    SELECT r.id
    FROM knowledge_file_requests r
    JOIN knowledge_document_versions v ON v.id = r.version_id AND v.user_id = r.user_id
    WHERE r.user_id = p_owner AND r.status = 'pending' AND r.expires_at > now()
      AND v.storage_location = 'local' AND v.cloud_purged_at IS NOT NULL
    ORDER BY r.created_at, r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE knowledge_file_requests r
    SET status = 'uploading', claimed_at = now(), error = NULL
    FROM candidates c WHERE r.id = c.id
    RETURNING r.id, r.version_id, r.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'request_id', c.id, 'version_id', v.id, 'relative_path', v.storage_path,
    'sha256', v.content_hash, 'file_size', v.file_size, 'mime_type', v.mime_type,
    'original_filename', v.original_filename
  ) ORDER BY c.id), '[]'::jsonb) INTO v_result
  FROM claimed c
  JOIN knowledge_document_versions v ON v.id = c.version_id AND v.user_id = c.user_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_central_request_ready(
  p_owner uuid, p_worker uuid, p_request_id uuid, p_cache_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request knowledge_file_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF p_cache_path IS NULL
    OR p_cache_path !~ ('^' || p_owner::text || '/' || p_request_id::text || '/[A-Za-z0-9._-]{1,120}$') THEN
    RAISE EXCEPTION 'Ruta de caché inválida';
  END IF;
  SELECT * INTO v_request FROM knowledge_file_requests
  WHERE id = p_request_id AND user_id = p_owner AND status = 'uploading'
  FOR UPDATE;
  IF NOT FOUND OR v_request.expires_at <= now() THEN
    RAISE EXCEPTION 'La solicitud de original venció';
  END IF;
  UPDATE knowledge_file_requests
  SET status = 'ready', cache_path = p_cache_path, error = NULL,
      ready_at = now(), expires_at = now() + interval '30 minutes', claimed_at = NULL
  WHERE id = p_request_id AND user_id = p_owner;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_central_request_failed(
  p_owner uuid, p_worker uuid, p_request_id uuid, p_error text, p_cache_path text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF char_length(COALESCE(p_error, '')) > 500
    OR (p_cache_path IS NOT NULL
      AND p_cache_path !~ ('^' || p_owner::text || '/' || p_request_id::text || '/[A-Za-z0-9._-]{1,120}$')) THEN
    RAISE EXCEPTION 'Error de solicitud inválido';
  END IF;
  UPDATE knowledge_file_requests
  SET status = 'failed', error = NULLIF(p_error, ''), cache_path = p_cache_path,
      expires_at = now(), claimed_at = NULL
  WHERE id = p_request_id AND user_id = p_owner AND status = 'uploading';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_central_expired_requests(p_owner uuid, p_worker uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', id, 'cache_path', cache_path) ORDER BY created_at, id)
    FROM (
      SELECT id, cache_path, created_at FROM knowledge_file_requests
      WHERE user_id = p_owner
        AND ((status IN ('pending', 'uploading', 'ready', 'failed')
              AND (expires_at <= now() OR created_at <= now() - interval '30 minutes'))
          OR (status = 'expired' AND cache_path IS NOT NULL))
      ORDER BY created_at, id LIMIT 100
    ) expired
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_central_cache_cleanup_done(
  p_owner uuid, p_worker uuid, p_request_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  UPDATE knowledge_file_requests SET status = 'expired', cache_path = NULL,
    error = COALESCE(error, 'La solicitud venció.')
  WHERE user_id = p_owner AND id = ANY(COALESCE(p_request_ids, '{}'))
    AND ((status IN ('pending', 'uploading', 'ready', 'failed')
          AND (expires_at <= now() OR created_at <= now() - interval '30 minutes'))
      OR (status = 'expired' AND cache_path IS NOT NULL));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.knowledge_open_original(uuid),
  public.knowledge_file_request_status(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.knowledge_open_original(uuid),
  public.knowledge_file_request_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.knowledge_central_next_requests(uuid, uuid, integer),
  public.knowledge_central_request_ready(uuid, uuid, uuid, text),
  public.knowledge_central_request_failed(uuid, uuid, uuid, text, text),
  public.knowledge_central_expired_requests(uuid, uuid),
  public.knowledge_central_cache_cleanup_done(uuid, uuid, uuid[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_central_next_requests(uuid, uuid, integer),
  public.knowledge_central_request_ready(uuid, uuid, uuid, text),
  public.knowledge_central_request_failed(uuid, uuid, uuid, text, text),
  public.knowledge_central_expired_requests(uuid, uuid),
  public.knowledge_central_cache_cleanup_done(uuid, uuid, uuid[])
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

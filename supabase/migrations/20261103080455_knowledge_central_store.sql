-- E4 · Keep original Knowledge files on the business central after verified transfer.
BEGIN;

ALTER TABLE public.knowledge_document_versions
  ADD COLUMN storage_location text NOT NULL DEFAULT 'cloud'
    CHECK (storage_location IN ('cloud', 'transferring', 'local', 'missing')),
  ADD COLUMN transfer_claimed_at timestamptz,
  ADD COLUMN transfer_worker_id uuid REFERENCES public.ai_bridge_devices(id) ON DELETE SET NULL,
  ADD COLUMN local_stored_at timestamptz,
  ADD COLUMN local_verified_at timestamptz,
  ADD COLUMN cloud_purge_after timestamptz,
  ADD COLUMN cloud_purged_at timestamptz;

CREATE INDEX knowledge_versions_transfer_idx
  ON public.knowledge_document_versions (user_id, storage_location)
  WHERE storage_path IS NOT NULL AND cloud_purged_at IS NULL;

CREATE TABLE public.ai_central_status (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id         uuid NOT NULL REFERENCES public.ai_bridge_devices(id) ON DELETE CASCADE,
  store_bytes       bigint NOT NULL DEFAULT 0 CHECK (store_bytes >= 0),
  store_free_bytes  bigint CHECK (store_free_bytes >= 0),
  mirror_status     text NOT NULL DEFAULT 'none' CHECK (mirror_status IN ('none', 'ok', 'error')),
  mirror_last_ok_at timestamptz,
  files_total       integer NOT NULL DEFAULT 0 CHECK (files_total >= 0),
  files_missing     integer NOT NULL DEFAULT 0 CHECK (files_missing >= 0),
  reported_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_central_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_central_status FROM PUBLIC, anon, authenticated;

CREATE TABLE public.knowledge_central_deletions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relative_path text NOT NULL CHECK (
    relative_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/v[0-9]{1,5}/[A-Za-z0-9._-]{1,120}$'
  ),
  created_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz
);
ALTER TABLE public.knowledge_central_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_central_deletions FROM PUBLIC, anon, authenticated;
CREATE INDEX knowledge_central_deletions_pending_idx
  ON public.knowledge_central_deletions (user_id, created_at)
  WHERE done_at IS NULL;
CREATE UNIQUE INDEX knowledge_central_deletions_one_pending_path_idx
  ON public.knowledge_central_deletions (user_id, relative_path)
  WHERE done_at IS NULL;

CREATE OR REPLACE FUNCTION public.knowledge_storage_used(p_owner uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT sum(file_size) FROM (
           SELECT DISTINCT ON (storage_path) storage_path, file_size
           FROM knowledge_document_versions
           WHERE user_id = p_owner AND storage_path IS NOT NULL AND cloud_purged_at IS NULL
           ORDER BY storage_path, version_number DESC
         ) v), 0)
       + COALESCE((SELECT sum(file_size) FROM knowledge_assets WHERE user_id = p_owner), 0)
$$;

CREATE FUNCTION public.knowledge_local_used(p_owner uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(file_size), 0)::bigint
  FROM (
    SELECT DISTINCT ON (storage_path) storage_path, file_size
    FROM public.knowledge_document_versions
    WHERE user_id = p_owner AND storage_location IN ('local', 'transferring')
      AND storage_path IS NOT NULL
    ORDER BY storage_path, version_number DESC
  ) local_versions
$$;

CREATE FUNCTION public.knowledge_central_local_file(p_owner uuid, p_worker uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_file jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  SELECT jsonb_build_object(
    'relative_path', storage_path, 'sha256', content_hash, 'file_size', file_size,
    'mime_type', mime_type
  ) INTO v_file
  FROM knowledge_document_versions
  WHERE id = p_version_id AND user_id = p_owner AND storage_location = 'local'
    AND storage_path IS NOT NULL;
  RETURN v_file;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_add_file_version(
  p_document_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size bigint,
  p_content_hash text,
  p_extracted_text text DEFAULT NULL,
  p_change_note text DEFAULT ''
)
RETURNS public.knowledge_document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_next integer;
  v_status text;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF v_doc.kind <> 'file' THEN RAISE EXCEPTION 'Este documento se edita con el editor'; END IF;
  IF v_doc.status IN ('archived', 'deleting') THEN RAISE EXCEPTION 'Restaurá el documento antes de agregar versiones'; END IF;
  IF p_storage_path IS NULL OR p_storage_path !~ ('^' || v_owner::text || '/' || v_doc.id::text || '/v[0-9]{1,5}/[A-Za-z0-9._-]{1,120}$') THEN
    RAISE EXCEPTION 'Ruta de archivo inválida';
  END IF;
  IF NOT knowledge_mime_allowed(v_doc.format, p_mime_type) THEN RAISE EXCEPTION 'Tipo de archivo no permitido'; END IF;
  IF p_file_size IS NULL OR p_file_size < 1 OR p_file_size > 52428800 THEN RAISE EXCEPTION 'El archivo supera 50 MB'; END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Huella de archivo inválida'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || v_owner::text, 0));
  PERFORM business_require_active(v_owner);
  IF knowledge_storage_used(v_owner) + p_file_size > business_limit_bigint(v_owner, 'cloud_knowledge_bytes') THEN
    RAISE EXCEPTION 'Se alcanzó el límite de almacenamiento de Conocimientos';
  END IF;
  IF knowledge_local_used(v_owner) + p_file_size > business_limit_bigint(v_owner, 'local_knowledge_bytes') THEN
    RAISE EXCEPTION 'Se llenó el espacio de la central de este negocio';
  END IF;
  IF NOT platform_cloud_upload_allowed(p_file_size) THEN
    RAISE EXCEPTION 'El espacio en la nube de RivaStock está lleno. Avisá a RivaTech.';
  END IF;

  v_status := CASE
    WHEN p_extracted_text IS NOT NULL THEN 'done'
    WHEN v_doc.format = 'image' THEN 'not_supported'
    ELSE 'pending'
  END;
  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM knowledge_document_versions WHERE document_id = v_doc.id;

  INSERT INTO knowledge_document_versions (user_id, document_id, version_number, source, storage_path,
    original_filename, mime_type, file_size, extracted_text, extraction_status, content_hash, change_note, created_by)
  VALUES (v_owner, v_doc.id, v_next, 'upload', p_storage_path, left(p_original_filename, 255), p_mime_type, p_file_size,
    left(p_extracted_text, 2000000), v_status, p_content_hash, left(COALESCE(p_change_note, ''), 300), auth.uid())
  RETURNING * INTO v_version;

  UPDATE knowledge_documents SET current_version_id = v_version.id,
    search_text = left(COALESCE(p_extracted_text, ''), 100000),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id;
  PERFORM knowledge_log(v_owner, v_doc.id, 'version_added',
    jsonb_build_object('version', v_next, 'filename', left(p_original_filename, 120), 'size', p_file_size));
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'documents', count(*) FILTER (WHERE status <> 'deleting'),
      'draft', count(*) FILTER (WHERE status = 'draft'),
      'in_review', count(*) FILTER (WHERE status = 'in_review'),
      'published', count(*) FILTER (WHERE status = 'published'),
      'archived', count(*) FILTER (WHERE status = 'archived'),
      'deleting', count(*) FILTER (WHERE status = 'deleting'),
      'index_queued', count(*) FILTER (WHERE index_status = 'queued'),
      'index_processing', count(*) FILTER (WHERE index_status = 'processing'),
      'index_ready', count(*) FILTER (WHERE index_status = 'ready'),
      'index_error', count(*) FILTER (WHERE index_status = 'error'),
      'available_to_ai', count(*) FILTER (WHERE status = 'published' AND rag_enabled AND index_status = 'ready'),
      'chunks', COALESCE(sum(chunk_count), 0),
      'last_updated_at', max(updated_at),
      'last_indexed_at', max(last_indexed_at),
      'storage_bytes', knowledge_storage_used(v_owner),
      'storage_limit_bytes', business_limit_bigint(v_owner, 'cloud_knowledge_bytes'),
      'local_storage_bytes', knowledge_local_used(v_owner),
      'local_storage_limit_bytes', business_limit_bigint(v_owner, 'local_knowledge_bytes')
    )
    FROM knowledge_documents WHERE user_id = v_owner
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_prepare_delete(p_document_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('delete');
  v_doc knowledge_documents%ROWTYPE;
  v_paths text[];
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF v_doc.status <> 'deleting' THEN
    UPDATE knowledge_documents SET status = 'deleting', rag_enabled = false, index_status = 'excluded',
      updated_at = now(), updated_by = auth.uid()
    WHERE id = v_doc.id;
    PERFORM knowledge_log(v_owner, v_doc.id, 'delete_started', jsonb_build_object('title', v_doc.title));
  END IF;

  INSERT INTO knowledge_central_deletions (user_id, relative_path)
  SELECT v_owner, v.storage_path
  FROM knowledge_document_versions v
  WHERE v.document_id = v_doc.id AND v.user_id = v_owner
    AND v.storage_path IS NOT NULL AND v.storage_location IN ('transferring', 'local', 'missing')
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(array_agg(DISTINCT p), '{}') INTO v_paths FROM (
    SELECT storage_path AS p FROM knowledge_document_versions
      WHERE document_id = v_doc.id AND user_id = v_owner AND storage_path IS NOT NULL AND cloud_purged_at IS NULL
    UNION
    SELECT storage_path FROM knowledge_assets WHERE document_id = v_doc.id AND user_id = v_owner
  ) paths;
  RETURN v_paths;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_restore_version(p_document_id uuid, p_version_id uuid)
RETURNS public.knowledge_document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
  v_source knowledge_document_versions%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_next integer;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_doc.status IN ('archived', 'deleting') THEN RAISE EXCEPTION 'Documento no disponible'; END IF;
  SELECT * INTO v_source FROM knowledge_document_versions WHERE id = p_version_id AND document_id = v_doc.id AND user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versión inexistente'; END IF;
  IF v_source.id = v_doc.current_version_id THEN RAISE EXCEPTION 'Esa ya es la versión actual'; END IF;
  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM knowledge_document_versions WHERE document_id = v_doc.id;
  INSERT INTO knowledge_document_versions (user_id, document_id, version_number, source, storage_path,
    original_filename, mime_type, file_size, content_json, content_markdown, extracted_text,
    extraction_status, page_count, content_hash, change_note, created_by,
    storage_location, local_stored_at, local_verified_at, cloud_purge_after, cloud_purged_at)
  VALUES (v_owner, v_doc.id, v_next, 'restore', v_source.storage_path, v_source.original_filename,
    v_source.mime_type, v_source.file_size, v_source.content_json, v_source.content_markdown,
    v_source.extracted_text, v_source.extraction_status, v_source.page_count, v_source.content_hash,
    'Restaurada desde la versión ' || v_source.version_number, auth.uid(),
    CASE WHEN v_source.storage_location = 'transferring' THEN 'cloud' ELSE v_source.storage_location END,
    CASE WHEN v_source.storage_location = 'transferring' THEN NULL ELSE v_source.local_stored_at END,
    CASE WHEN v_source.storage_location = 'transferring' THEN NULL ELSE v_source.local_verified_at END,
    CASE WHEN v_source.storage_location = 'transferring' THEN NULL ELSE v_source.cloud_purge_after END,
    CASE WHEN v_source.storage_location = 'transferring' THEN NULL ELSE v_source.cloud_purged_at END)
  RETURNING * INTO v_version;
  UPDATE knowledge_documents SET current_version_id = v_version.id,
    draft_content = CASE WHEN kind = 'editor' THEN v_source.content_json ELSE draft_content END,
    draft_revision = CASE WHEN kind = 'editor' THEN draft_revision + 1 ELSE draft_revision END,
    search_text = left(COALESCE(v_source.extracted_text, ''), 100000),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id;
  PERFORM knowledge_log(v_owner, v_doc.id, 'version_restored',
    jsonb_build_object('from_version', v_source.version_number, 'new_version', v_next));
  RETURN v_version;
END;
$$;

CREATE FUNCTION public.knowledge_central_next_transfer(p_owner uuid, p_worker uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  UPDATE knowledge_document_versions
    SET storage_location = CASE WHEN cloud_purged_at IS NULL THEN 'cloud' ELSE 'missing' END,
        transfer_claimed_at = NULL, transfer_worker_id = NULL
    WHERE user_id = p_owner AND storage_location = 'transferring'
      AND transfer_claimed_at < now() - interval '30 minutes';

  WITH candidates AS (
    SELECT v.id
    FROM knowledge_document_versions v
    JOIN knowledge_documents d ON d.id = v.document_id AND d.user_id = v.user_id
    WHERE v.user_id = p_owner AND v.storage_location = 'cloud' AND v.storage_path IS NOT NULL
      AND v.cloud_purged_at IS NULL AND d.status <> 'deleting'
    ORDER BY v.created_at, v.id
    FOR UPDATE OF v SKIP LOCKED
    LIMIT 5
  ), claimed AS (
    UPDATE knowledge_document_versions v
      SET storage_location = 'transferring', transfer_claimed_at = now(), transfer_worker_id = p_worker
      FROM candidates c WHERE v.id = c.id AND v.user_id = p_owner
      RETURNING v.id, v.storage_path, v.content_hash, v.file_size, v.mime_type, v.original_filename
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'version_id', id, 'storage_path', storage_path, 'relative_path', storage_path,
    'sha256', content_hash, 'file_size', file_size, 'mime_type', mime_type,
    'original_filename', original_filename
  ) ORDER BY id), '[]'::jsonb) INTO v_result FROM claimed;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.knowledge_central_stored(p_owner uuid, p_worker uuid, p_version_id uuid, p_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version knowledge_document_versions%ROWTYPE;
  v_deleting boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  SELECT * INTO v_version FROM knowledge_document_versions
    WHERE id = p_version_id AND user_id = p_owner FOR UPDATE;
  IF NOT FOUND OR v_version.storage_location <> 'transferring' OR v_version.transfer_worker_id <> p_worker THEN
    RAISE EXCEPTION 'El original ya no está reservado para transferencia';
  END IF;
  SELECT status = 'deleting' INTO v_deleting FROM knowledge_documents
    WHERE id = v_version.document_id AND user_id = p_owner;
  IF p_sha256 IS DISTINCT FROM v_version.content_hash THEN
    UPDATE knowledge_document_versions
      SET storage_location = CASE WHEN cloud_purged_at IS NULL THEN 'cloud' ELSE 'missing' END,
          transfer_claimed_at = NULL, transfer_worker_id = NULL
      WHERE id = p_version_id AND user_id = p_owner;
    PERFORM knowledge_log(p_owner, v_version.document_id, 'central_transfer_hash_mismatch',
      jsonb_build_object('version_id', p_version_id));
    RETURN jsonb_build_object('stored', false, 'reason', 'hash_mismatch');
  END IF;
  UPDATE knowledge_document_versions
    SET storage_location = 'local', transfer_claimed_at = NULL,
        transfer_worker_id = NULL,
        local_stored_at = now(), local_verified_at = now(),
        cloud_purge_after = COALESCE(cloud_purge_after, now() + interval '72 hours')
    WHERE id = p_version_id AND user_id = p_owner;
  IF COALESCE(v_deleting, false) THEN
    INSERT INTO knowledge_central_deletions (user_id, relative_path)
    VALUES (p_owner, v_version.storage_path) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('stored', true, 'cloud_purge_after', now() + interval '72 hours');
END;
$$;

CREATE FUNCTION public.knowledge_central_inventory(p_owner uuid, p_worker uuid, p_inventory jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_version knowledge_document_versions%ROWTYPE;
  v_present boolean;
  v_hash text;
  v_checked integer := 0;
  v_missing integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF jsonb_typeof(p_inventory) <> 'array' OR jsonb_array_length(p_inventory) > 10000 THEN
    RAISE EXCEPTION 'Inventario de la central inválido';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_inventory) LOOP
    IF v_item->>'version_id' !~* '^[0-9a-f-]{36}$' OR jsonb_typeof(v_item->'present') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Elemento de inventario inválido';
    END IF;
    v_present := (v_item->>'present')::boolean;
    v_hash := NULLIF(v_item->>'sha256', '');
    IF v_present AND v_hash IS NOT NULL AND v_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Huella de inventario inválida';
    END IF;
    SELECT * INTO v_version FROM knowledge_document_versions
      WHERE id = (v_item->>'version_id')::uuid AND user_id = p_owner AND storage_path IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_present AND v_hash IS NULL THEN
      IF v_version.storage_location = 'local' THEN
        UPDATE knowledge_document_versions SET local_verified_at = now()
        WHERE id = v_version.id AND user_id = p_owner;
      ELSIF v_version.storage_location <> 'local' AND v_version.cloud_purged_at IS NULL THEN
        UPDATE knowledge_document_versions SET storage_location = 'cloud', transfer_claimed_at = NULL, transfer_worker_id = NULL
        WHERE id = v_version.id AND user_id = p_owner;
      ELSIF v_version.cloud_purged_at IS NOT NULL AND v_version.storage_location <> 'local' THEN
        UPDATE knowledge_document_versions SET storage_location = 'missing', transfer_claimed_at = NULL
        WHERE id = v_version.id AND user_id = p_owner;
        v_missing := v_missing + 1;
      END IF;
    ELSIF v_present AND v_hash = v_version.content_hash THEN
      UPDATE knowledge_document_versions SET storage_location = 'local',
        transfer_claimed_at = NULL, transfer_worker_id = NULL,
        local_stored_at = COALESCE(local_stored_at, now()), local_verified_at = now(),
        cloud_purge_after = COALESCE(cloud_purge_after, now() + interval '72 hours')
      WHERE id = v_version.id AND user_id = p_owner;
    ELSIF v_version.cloud_purged_at IS NULL THEN
      UPDATE knowledge_document_versions SET storage_location = 'cloud', transfer_claimed_at = NULL,
        transfer_worker_id = NULL, local_verified_at = NULL
      WHERE id = v_version.id AND user_id = p_owner;
      IF v_present THEN
        PERFORM knowledge_log(p_owner, v_version.document_id, 'central_inventory_hash_mismatch',
          jsonb_build_object('version_id', v_version.id));
      END IF;
    ELSE
      UPDATE knowledge_document_versions SET storage_location = 'missing', transfer_claimed_at = NULL,
        transfer_worker_id = NULL, local_verified_at = NULL
      WHERE id = v_version.id AND user_id = p_owner;
      v_missing := v_missing + 1;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;
  RETURN jsonb_build_object('checked', v_checked, 'missing', v_missing);
END;
$$;

CREATE FUNCTION public.knowledge_central_purge_ready(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('version_ids', version_ids, 'storage_path', storage_path)), '[]'::jsonb)
  FROM (
    SELECT storage_path, array_agg(id ORDER BY id) AS version_ids, min(cloud_purge_after) AS cloud_purge_after
    FROM knowledge_document_versions
    WHERE user_id = p_owner AND storage_location = 'local' AND cloud_purge_after < now()
      AND local_verified_at > now() - interval '24 hours' AND cloud_purged_at IS NULL
    GROUP BY storage_path ORDER BY min(cloud_purge_after), storage_path LIMIT 100
  ) ready
$$;

CREATE FUNCTION public.knowledge_central_list_expected(p_owner uuid, p_worker uuid, p_offset integer, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF p_offset < 0 OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Límite de inventario inválido';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'version_id', id, 'relative_path', storage_path, 'sha256', content_hash,
      'file_size', file_size, 'cloud_purged', cloud_purged_at IS NOT NULL,
      'storage_location', storage_location
    ) ORDER BY id)
    FROM (
      SELECT v.id, v.storage_path, v.content_hash, v.file_size, v.cloud_purged_at, v.storage_location
      FROM knowledge_document_versions v
      WHERE v.user_id = p_owner AND v.storage_path IS NOT NULL
      ORDER BY v.id OFFSET p_offset LIMIT p_limit
    ) versions
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.knowledge_central_purged(p_owner uuid, p_worker uuid, p_version_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  UPDATE knowledge_document_versions SET cloud_purged_at = now()
  WHERE user_id = p_owner AND id = ANY(COALESCE(p_version_ids, '{}'))
    AND storage_location = 'local' AND cloud_purge_after < now()
    AND local_verified_at > now() - interval '24 hours' AND cloud_purged_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.knowledge_central_deletions(p_owner uuid, p_worker uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'relative_path', relative_path)
    ORDER BY created_at, id), '[]'::jsonb) INTO v_result
  FROM (SELECT id, relative_path, created_at FROM knowledge_central_deletions
    WHERE user_id = p_owner AND done_at IS NULL ORDER BY created_at, id LIMIT 100) q;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.knowledge_central_deletions_done(p_owner uuid, p_worker uuid, p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  UPDATE knowledge_central_deletions SET done_at = now()
  WHERE user_id = p_owner AND id = ANY(COALESCE(p_ids, '{}')) AND done_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.knowledge_central_report_status(
  p_owner uuid, p_device uuid, p_store_bytes bigint, p_store_free_bytes bigint,
  p_mirror_status text, p_mirror_last_ok_at timestamptz, p_files_total integer, p_files_missing integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_device AND user_id = p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF p_store_bytes < 0 OR (p_store_free_bytes IS NOT NULL AND p_store_free_bytes < 0)
    OR p_files_total < 0 OR p_files_missing < 0 OR p_files_missing > p_files_total
    OR p_mirror_status NOT IN ('none', 'ok', 'error') THEN
    RAISE EXCEPTION 'Estado de la central inválido';
  END IF;
  INSERT INTO ai_central_status (user_id, device_id, store_bytes, store_free_bytes, mirror_status,
    mirror_last_ok_at, files_total, files_missing, reported_at)
  VALUES (p_owner, p_device, p_store_bytes, p_store_free_bytes, p_mirror_status,
    p_mirror_last_ok_at, p_files_total, p_files_missing, now())
  ON CONFLICT (user_id) DO UPDATE SET device_id = EXCLUDED.device_id,
    store_bytes = EXCLUDED.store_bytes, store_free_bytes = EXCLUDED.store_free_bytes,
    mirror_status = EXCLUDED.mirror_status,
    mirror_last_ok_at = CASE WHEN EXCLUDED.mirror_status = 'ok' THEN now()
      ELSE public.ai_central_status.mirror_last_ok_at END,
    files_total = EXCLUDED.files_total, files_missing = EXCLUDED.files_missing, reported_at = now();
END;
$$;

CREATE FUNCTION public.my_central_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := auth.uid();
BEGIN
  IF v_owner IS NULL OR EXISTS (SELECT 1 FROM collaborators WHERE user_uid = v_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede consultar la central';
  END IF;
  RETURN (SELECT jsonb_build_object(
    'device_id', device_id, 'store_bytes', store_bytes, 'store_free_bytes', store_free_bytes,
    'mirror_status', mirror_status, 'mirror_last_ok_at', mirror_last_ok_at,
    'files_total', files_total, 'files_missing', files_missing, 'reported_at', reported_at
  ) FROM ai_central_status WHERE user_id = v_owner);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_collect_usage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_storage jsonb;
  v_count integer := 0;
BEGIN
  FOR v_owner IN SELECT o FROM business_owner_ids() o LOOP
    v_storage := platform_storage_by_bucket(v_owner);
    INSERT INTO platform_usage_snapshots (owner_uid, db_bytes, storage_bytes, storage_total_bytes, local_knowledge_bytes)
    VALUES (
      v_owner,
      platform_owner_db_bytes(v_owner),
      v_storage,
      COALESCE((SELECT sum(value::bigint) FROM jsonb_each_text(v_storage)), 0),
      COALESCE((SELECT store_bytes FROM ai_central_status WHERE user_id = v_owner), 0)
    );
    v_count := v_count + 1;
  END LOOP;
  v_storage := platform_storage_by_bucket(NULL);
  INSERT INTO platform_usage_snapshots (owner_uid, db_bytes, storage_bytes, storage_total_bytes)
  VALUES (NULL, pg_database_size(current_database()), v_storage,
          COALESCE((SELECT sum(value::bigint) FROM jsonb_each_text(v_storage)), 0));
  DELETE FROM platform_usage_snapshots WHERE taken_at < now() - interval '90 days';
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_usage_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project platform_usage_snapshots%ROWTYPE;
  v_settings platform_settings%ROWTYPE;
BEGIN
  PERFORM platform_require_admin();
  SELECT * INTO v_settings FROM platform_settings WHERE id;
  SELECT * INTO v_project FROM platform_usage_snapshots WHERE owner_uid IS NULL ORDER BY taken_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'budgets', jsonb_build_object('db_bytes', v_settings.db_budget_bytes,
                                  'storage_bytes', v_settings.storage_budget_bytes,
                                  'warn_ratio', v_settings.warn_ratio),
    'live', jsonb_build_object('db_bytes', pg_database_size(current_database()),
                               'storage_bytes', platform_storage_total_bytes()),
    'last_snapshot_at', v_project.taken_at,
    'businesses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'owner_uid', o,
        'business_name', p.business_name,
        'email', p.email,
        'created_at', p.created_at,
        'plan_code', COALESCE(s.plan_code, 'base'),
        'status', COALESCE(s.status, 'active'),
        'db_bytes', u.db_bytes,
        'storage_bytes', u.storage_bytes,
        'storage_total_bytes', u.storage_total_bytes,
        'local_knowledge_bytes', COALESCE(c.store_bytes, u.local_knowledge_bytes, 0),
        'store_bytes', COALESCE(c.store_bytes, 0),
        'mirror_status', COALESCE(c.mirror_status, 'none'),
        'files_missing', COALESCE(c.files_missing, 0),
        'central_last_seen_at', (SELECT max(d.last_seen_at) FROM ai_bridge_devices d
                                 WHERE d.user_id = o AND d.revoked_at IS NULL)
      ) ORDER BY p.created_at)
      FROM business_owner_ids() o
      JOIN profiles p ON p.id = o
      LEFT JOIN business_subscriptions s ON s.owner_uid = o
      LEFT JOIN LATERAL (
        SELECT * FROM platform_usage_snapshots x WHERE x.owner_uid = o ORDER BY x.taken_at DESC LIMIT 1
      ) u ON true
      LEFT JOIN ai_central_status c ON c.user_id = o
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.knowledge_storage_used(uuid), public.knowledge_local_used(uuid),
  public.knowledge_central_next_transfer(uuid, uuid), public.knowledge_central_stored(uuid, uuid, uuid, text),
  public.knowledge_central_inventory(uuid, uuid, jsonb), public.knowledge_central_purge_ready(uuid),
  public.knowledge_central_purged(uuid, uuid, uuid[]), public.knowledge_central_deletions(uuid, uuid),
  public.knowledge_central_deletions_done(uuid, uuid, uuid[]),
  public.knowledge_central_report_status(uuid, uuid, bigint, bigint, text, timestamptz, integer, integer),
  public.knowledge_central_local_file(uuid, uuid, uuid),
  public.knowledge_central_list_expected(uuid, uuid, integer, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_central_next_transfer(uuid, uuid),
  public.knowledge_central_stored(uuid, uuid, uuid, text), public.knowledge_central_inventory(uuid, uuid, jsonb),
  public.knowledge_central_purge_ready(uuid), public.knowledge_central_purged(uuid, uuid, uuid[]),
  public.knowledge_central_deletions(uuid, uuid), public.knowledge_central_deletions_done(uuid, uuid, uuid[]),
  public.knowledge_central_report_status(uuid, uuid, bigint, bigint, text, timestamptz, integer, integer),
  public.knowledge_central_local_file(uuid, uuid, uuid),
  public.knowledge_central_list_expected(uuid, uuid, integer, integer)
TO service_role;
REVOKE ALL ON FUNCTION public.knowledge_add_file_version(uuid, text, text, text, bigint, text, text, text),
  public.knowledge_stats(), public.knowledge_prepare_delete(uuid), public.my_central_status()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_add_file_version(uuid, text, text, text, bigint, text, text, text),
  public.knowledge_stats(), public.knowledge_prepare_delete(uuid), public.my_central_status()
TO authenticated;
REVOKE ALL ON FUNCTION public.platform_collect_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_collect_usage() TO service_role;
REVOKE ALL ON FUNCTION public.platform_usage_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_usage_overview() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

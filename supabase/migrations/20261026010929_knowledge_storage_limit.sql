BEGIN;

CREATE OR REPLACE FUNCTION public.knowledge_storage_limit_bytes()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 524288000::bigint;
$$;
COMMENT ON FUNCTION public.knowledge_storage_limit_bytes() IS
  'subir a 10737418240 si el proyecto pasa a plan Pro';

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
  IF knowledge_storage_used(v_owner) + p_file_size > knowledge_storage_limit_bytes() THEN
    RAISE EXCEPTION 'Se alcanzó el límite de almacenamiento de Conocimientos';
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

CREATE OR REPLACE FUNCTION public.knowledge_register_asset(p_document_id uuid, p_storage_path text, p_mime_type text, p_file_size bigint)
RETURNS public.knowledge_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_asset knowledge_assets%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner AND status NOT IN ('archived', 'deleting')) THEN
    RAISE EXCEPTION 'Documento no disponible';
  END IF;
  IF p_storage_path !~ ('^' || v_owner::text || '/' || p_document_id::text || '/assets/[0-9a-f-]{36}\.(webp|png|jpg)$') THEN
    RAISE EXCEPTION 'Ruta de imagen inválida';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || v_owner::text, 0));
  IF knowledge_storage_used(v_owner) + p_file_size > knowledge_storage_limit_bytes() THEN
    RAISE EXCEPTION 'Se alcanzó el límite de almacenamiento de Conocimientos';
  END IF;
  INSERT INTO knowledge_assets (user_id, document_id, storage_path, mime_type, file_size)
  VALUES (v_owner, p_document_id, p_storage_path, p_mime_type, p_file_size)
  RETURNING * INTO v_asset;
  RETURN v_asset;
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
      'storage_limit_bytes', knowledge_storage_limit_bytes()
    )
    FROM knowledge_documents WHERE user_id = v_owner
  );
END;
$$;

REVOKE ALL ON FUNCTION public.knowledge_add_file_version(uuid, text, text, text, bigint, text, text, text),
  public.knowledge_register_asset(uuid, text, text, bigint), public.knowledge_stats()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_add_file_version(uuid, text, text, text, bigint, text, text, text),
  public.knowledge_register_asset(uuid, text, text, bigint), public.knowledge_stats()
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

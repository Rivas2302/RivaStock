BEGIN;

CREATE TABLE public.knowledge_index_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL,
  version_id        uuid NOT NULL,
  reason            text NOT NULL CHECK (reason IN ('publish', 'rag_enabled', 'reindex', 'backfill')),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count     integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  worker_id         uuid,
  lease_expires_at  timestamptz,
  available_at      timestamptz NOT NULL DEFAULT now(),
  error             text CHECK (error IS NULL OR char_length(error) <= 1000),
  stats             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(stats::text) <= 4000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz,
  FOREIGN KEY (user_id, document_id) REFERENCES public.knowledge_documents(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, version_id) REFERENCES public.knowledge_document_versions(user_id, id) ON DELETE CASCADE,
  CHECK ((status = 'processing') = (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX knowledge_index_jobs_one_open_idx ON public.knowledge_index_jobs (document_id)
  WHERE status IN ('pending', 'processing');
CREATE INDEX knowledge_index_jobs_claim_idx ON public.knowledge_index_jobs (user_id, status, available_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX knowledge_index_jobs_owner_created_idx ON public.knowledge_index_jobs (user_id, created_at DESC);

ALTER TABLE public.knowledge_documents
  ADD COLUMN indexed_job_id uuid REFERENCES public.knowledge_index_jobs(id) ON DELETE SET NULL;

CREATE TABLE public.knowledge_chunks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL,
  version_id       uuid NOT NULL,
  job_id           uuid NOT NULL REFERENCES public.knowledge_index_jobs(id) ON DELETE CASCADE,
  chunk_index      integer NOT NULL CHECK (chunk_index BETWEEN 0 AND 1999),
  content          text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  section_path     text NOT NULL DEFAULT '' CHECK (char_length(section_path) <= 300),
  page_from        integer CHECK (page_from IS NULL OR page_from >= 1),
  page_to          integer CHECK (page_to IS NULL OR page_to >= 1),
  token_estimate   integer NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  content_hash     text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  embedding        extensions.vector(384) NOT NULL,
  embedding_model  text NOT NULL CHECK (char_length(embedding_model) BETWEEN 1 AND 120),
  search_tsv       tsvector GENERATED ALWAYS AS (
                     to_tsvector('spanish', public.kb_unaccent(section_path || ' ' || content))
                   ) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, chunk_index),
  FOREIGN KEY (user_id, document_id) REFERENCES public.knowledge_documents(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, version_id) REFERENCES public.knowledge_document_versions(user_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_chunks_owner_doc_idx ON public.knowledge_chunks (user_id, document_id, job_id);
CREATE INDEX knowledge_chunks_tsv_idx ON public.knowledge_chunks USING gin (search_tsv);
CREATE INDEX knowledge_chunks_embedding_idx ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE TABLE public.knowledge_search_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query         text NOT NULL CHECK (char_length(btrim(query)) BETWEEN 2 AND 500),
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(filters) = 'object' AND octet_length(filters::text) <= 2000),
  top_k         integer NOT NULL DEFAULT 10 CHECK (top_k BETWEEN 1 AND 30),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  results       jsonb,
  error         text CHECK (error IS NULL OR char_length(error) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX knowledge_search_requests_owner_idx ON public.knowledge_search_requests (user_id, status, created_at);

ALTER TABLE public.knowledge_index_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_search_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_index_jobs_read ON public.knowledge_index_jobs FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_chunks_read ON public.knowledge_chunks FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_search_requests_read ON public.knowledge_search_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
REVOKE ALL ON public.knowledge_index_jobs, public.knowledge_chunks, public.knowledge_search_requests FROM anon, authenticated;
GRANT SELECT ON public.knowledge_index_jobs, public.knowledge_search_requests TO authenticated;
GRANT SELECT (id, user_id, document_id, version_id, job_id, chunk_index, content, section_path, page_from, page_to,
  token_estimate, embedding_model, created_at) ON public.knowledge_chunks TO authenticated;

-- ───────── Index lifecycle (internal) ─────────
CREATE OR REPLACE FUNCTION public.knowledge_invalidate_index(p_owner uuid, p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE knowledge_index_jobs SET status = 'cancelled', worker_id = NULL, lease_expires_at = NULL, completed_at = now()
   WHERE document_id = p_document_id AND user_id = p_owner AND status IN ('pending', 'processing');
  UPDATE knowledge_documents SET indexed_job_id = NULL, indexed_version_id = NULL, chunk_count = 0, index_error = NULL,
    index_status = CASE WHEN rag_enabled THEN 'not_indexed' ELSE 'excluded' END
   WHERE id = p_document_id AND user_id = p_owner;
  DELETE FROM knowledge_chunks WHERE document_id = p_document_id AND user_id = p_owner;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_enqueue_index(p_owner uuid, p_document_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc knowledge_documents%ROWTYPE;
  v_published_hash text;
  v_indexed_hash text;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = p_owner FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'published' OR NOT v_doc.rag_enabled OR v_doc.published_version_id IS NULL THEN
    RETURN;
  END IF;
  IF p_reason <> 'reindex' AND v_doc.index_status = 'ready' AND v_doc.indexed_job_id IS NOT NULL THEN
    IF v_doc.indexed_version_id = v_doc.published_version_id THEN RETURN; END IF;
    -- Same content already indexed under another version: reuse the vectors.
    SELECT content_hash INTO v_published_hash FROM knowledge_document_versions WHERE id = v_doc.published_version_id;
    SELECT content_hash INTO v_indexed_hash FROM knowledge_document_versions WHERE id = v_doc.indexed_version_id;
    IF v_published_hash = v_indexed_hash THEN
      UPDATE knowledge_chunks SET version_id = v_doc.published_version_id WHERE job_id = v_doc.indexed_job_id;
      UPDATE knowledge_documents SET indexed_version_id = v_doc.published_version_id WHERE id = v_doc.id;
      PERFORM knowledge_log(p_owner, v_doc.id, 'index_reused', jsonb_build_object('version_id', v_doc.published_version_id));
      RETURN;
    END IF;
  END IF;
  UPDATE knowledge_index_jobs SET status = 'cancelled', worker_id = NULL, lease_expires_at = NULL, completed_at = now()
   WHERE document_id = v_doc.id AND status IN ('pending', 'processing');
  INSERT INTO knowledge_index_jobs (user_id, document_id, version_id, reason)
  VALUES (p_owner, v_doc.id, v_doc.published_version_id, p_reason);
  UPDATE knowledge_documents SET index_status = 'queued', index_error = NULL WHERE id = v_doc.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_documents_index_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.rag_enabled AND NEW.published_version_id IS NOT NULL THEN
    IF OLD.status IS DISTINCT FROM 'published' OR NOT OLD.rag_enabled
       OR OLD.published_version_id IS DISTINCT FROM NEW.published_version_id THEN
      PERFORM knowledge_enqueue_index(NEW.user_id, NEW.id,
        CASE WHEN OLD.status = 'published' AND NOT OLD.rag_enabled THEN 'rag_enabled' ELSE 'publish' END);
    END IF;
  ELSIF (OLD.status = 'published' AND OLD.rag_enabled)
     OR OLD.index_status IN ('queued', 'processing', 'ready', 'error') THEN
    PERFORM knowledge_invalidate_index(NEW.user_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER knowledge_documents_index_sync
  AFTER UPDATE OF status, rag_enabled, published_version_id ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_documents_index_sync();

-- ───────── Hybrid retrieval (vector + keywords, RRF k=60) ─────────
CREATE OR REPLACE FUNCTION public.knowledge_match_chunks(
  p_owner uuid,
  p_embedding extensions.vector,
  p_query text,
  p_match_count integer DEFAULT 8,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_model text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid, document_id uuid, version_id uuid, version_number integer, title text, section_path text,
  page_from integer, page_to integer, content text, similarity double precision, text_rank real, score double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_query tsquery;
  v_limit integer := LEAST(GREATEST(COALESCE(p_match_count, 8), 1), 30);
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
BEGIN
  IF p_query IS NOT NULL AND btrim(p_query) <> '' THEN
    v_query := websearch_to_tsquery('spanish', kb_unaccent(left(p_query, 500)));
    IF numnode(v_query) = 0 THEN v_query := NULL; END IF;
  END IF;
  RETURN QUERY
  WITH eligible AS (
    SELECT c.id AS cid, c.document_id AS did, c.version_id AS vid, v.version_number AS vnum, d.title AS dtitle,
           c.section_path AS spath, c.page_from AS pfrom, c.page_to AS pto, c.content AS ctext,
           c.embedding AS emb, c.search_tsv AS tsv
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id AND d.user_id = c.user_id
    JOIN knowledge_document_versions v ON v.id = c.version_id
    WHERE c.user_id = p_owner
      AND d.status = 'published' AND d.rag_enabled
      AND c.job_id = d.indexed_job_id
      AND d.indexed_version_id = d.published_version_id
      AND (p_model IS NULL OR c.embedding_model = p_model)
      AND (NOT (v_filters ? 'document_ids') OR d.id::text IN (SELECT jsonb_array_elements_text(v_filters->'document_ids')))
      AND (NOT (v_filters ? 'category_ids') OR d.category_id::text IN (SELECT jsonb_array_elements_text(v_filters->'category_ids')))
      AND (NOT (v_filters ? 'folder_ids') OR d.folder_id::text IN (SELECT jsonb_array_elements_text(v_filters->'folder_ids')))
      AND (NOT (v_filters ? 'tag_ids') OR EXISTS (
            SELECT 1 FROM knowledge_document_tags t WHERE t.document_id = d.id
              AND t.tag_id::text IN (SELECT jsonb_array_elements_text(v_filters->'tag_ids'))))
  ),
  vec AS (
    SELECT e.cid, row_number() OVER (ORDER BY e.emb <=> p_embedding) AS r, 1 - (e.emb <=> p_embedding) AS sim
    FROM eligible e
    WHERE p_embedding IS NOT NULL
    ORDER BY e.emb <=> p_embedding
    LIMIT 50
  ),
  kw AS (
    SELECT e.cid, row_number() OVER (ORDER BY ts_rank_cd(e.tsv, v_query) DESC) AS r, ts_rank_cd(e.tsv, v_query) AS tr
    FROM eligible e
    WHERE v_query IS NOT NULL AND e.tsv @@ v_query
    ORDER BY ts_rank_cd(e.tsv, v_query) DESC
    LIMIT 50
  )
  SELECT e.cid, e.did, e.vid, e.vnum, e.dtitle, e.spath, e.pfrom, e.pto, e.ctext,
         vec.sim::double precision, kw.tr,
         (COALESCE(1.0 / (60 + vec.r), 0) + COALESCE(1.0 / (60 + kw.r), 0))::double precision
  FROM eligible e
  LEFT JOIN vec ON vec.cid = e.cid
  LEFT JOIN kw ON kw.cid = e.cid
  WHERE vec.cid IS NOT NULL OR kw.cid IS NOT NULL
  ORDER BY 12 DESC, 10 DESC NULLS LAST
  LIMIT v_limit;
END;
$$;

-- Keyword-only chunk search for the browser (works without the PC).
CREATE OR REPLACE FUNCTION public.knowledge_search_chunks_text(p_query text, p_top_k integer DEFAULT 10, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.score DESC), '[]'::jsonb) INTO v_result
  FROM knowledge_match_chunks(v_owner, NULL, p_query, p_top_k, p_filters, NULL) m;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_request_search(p_query text, p_filters jsonb DEFAULT '{}'::jsonb, p_top_k integer DEFAULT 10)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
  v_id uuid;
BEGIN
  IF p_query IS NULL OR char_length(btrim(p_query)) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'Escribí entre 2 y 500 caracteres';
  END IF;
  DELETE FROM knowledge_search_requests WHERE user_id = v_owner AND created_at < now() - interval '1 day';
  IF (SELECT count(*) FROM knowledge_search_requests
      WHERE user_id = v_owner AND status IN ('pending', 'processing') AND created_at > now() - interval '30 seconds') >= 5 THEN
    RAISE EXCEPTION 'Hay demasiadas búsquedas en curso. Esperá unos segundos.';
  END IF;
  INSERT INTO knowledge_search_requests (user_id, query, filters, top_k)
  VALUES (v_owner, btrim(p_query), COALESCE(p_filters, '{}'::jsonb), LEAST(GREATEST(COALESCE(p_top_k, 10), 1), 30))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_reindex_document(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner
                 AND status = 'published' AND rag_enabled) THEN
    RAISE EXCEPTION 'Solo se indexan documentos publicados y habilitados para la IA';
  END IF;
  PERFORM knowledge_enqueue_index(v_owner, p_document_id, 'reindex');
  PERFORM knowledge_log(v_owner, p_document_id, 'reindex_requested', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_reindex_all(p_only_errors boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN SELECT id FROM knowledge_documents
              WHERE user_id = v_owner AND status = 'published' AND rag_enabled
                AND (NOT p_only_errors OR index_status = 'error') LOOP
    PERFORM knowledge_enqueue_index(v_owner, v_id, 'reindex');
    v_count := v_count + 1;
  END LOOP;
  PERFORM knowledge_log(v_owner, NULL, 'reindex_all_requested', jsonb_build_object('count', v_count, 'only_errors', p_only_errors));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_worker(
  p_action text,
  p_owner_uid uuid,
  p_worker_id uuid,
  p_job_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_job knowledge_index_jobs%ROWTYPE;
  v_doc knowledge_documents%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_request knowledge_search_requests%ROWTYPE;
  v_chunk jsonb;
  v_count integer;
  v_results jsonb;
  v_model text;
  v_failed boolean;
BEGIN
  IF p_owner_uid IS NULL OR p_worker_id IS NULL THEN RAISE EXCEPTION 'Worker inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM ai_bridge_devices WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  p_payload := COALESCE(p_payload, '{}'::jsonb);

  IF p_action = 'next' THEN
    UPDATE knowledge_search_requests SET status = 'expired', completed_at = now()
     WHERE user_id = p_owner_uid AND status IN ('pending', 'processing') AND created_at < now() - interval '30 seconds';
    SELECT * INTO v_request FROM knowledge_search_requests
     WHERE user_id = p_owner_uid AND status = 'pending'
     ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      UPDATE knowledge_search_requests SET status = 'processing' WHERE id = v_request.id;
      RETURN jsonb_build_object('kind', 'search', 'request_id', v_request.id, 'query', v_request.query);
    END IF;

    WITH failed AS (
      UPDATE knowledge_index_jobs SET status = 'failed', worker_id = NULL, lease_expires_at = NULL, completed_at = now(),
        error = 'La PC se desconectó varias veces durante la indexación.'
       WHERE user_id = p_owner_uid AND status = 'processing' AND lease_expires_at <= now() AND attempt_count >= 3
      RETURNING document_id, error
    )
    UPDATE knowledge_documents d SET index_status = 'error', index_error = failed.error
      FROM failed WHERE d.id = failed.document_id AND d.user_id = p_owner_uid;

    SELECT * INTO v_job FROM knowledge_index_jobs
     WHERE user_id = p_owner_uid AND attempt_count < 3 AND available_at <= now()
       AND (status = 'pending' OR (status = 'processing' AND lease_expires_at <= now()))
     ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE knowledge_index_jobs SET status = 'processing', worker_id = p_worker_id,
      lease_expires_at = now() + interval '10 minutes', started_at = COALESCE(started_at, now()),
      attempt_count = attempt_count + 1, error = NULL
     WHERE id = v_job.id RETURNING * INTO v_job;
    UPDATE knowledge_documents SET index_status = 'processing' WHERE id = v_job.document_id RETURNING * INTO v_doc;
    SELECT * INTO v_version FROM knowledge_document_versions WHERE id = v_job.version_id;
    RETURN jsonb_build_object(
      'kind', 'index', 'job_id', v_job.id, 'attempt', v_job.attempt_count,
      'document_id', v_doc.id, 'title', v_doc.title, 'description', v_doc.description, 'format', v_doc.format,
      'version_id', v_version.id, 'version_number', v_version.version_number,
      'mime_type', v_version.mime_type, 'file_size', v_version.file_size,
      'has_file', v_version.storage_path IS NOT NULL,
      'inline_text', CASE WHEN v_doc.format IN ('editor', 'md', 'txt')
                          THEN COALESCE(v_version.content_markdown, v_version.extracted_text) END
    );
  END IF;

  IF p_action IN ('job_heartbeat', 'extracted_text', 'submit_chunks', 'complete', 'fail') THEN
    SELECT * INTO v_job FROM knowledge_index_jobs
     WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La tarea ya no está reservada por este worker'; END IF;
  END IF;

  IF p_action = 'job_heartbeat' THEN
    UPDATE knowledge_index_jobs SET lease_expires_at = now() + interval '10 minutes' WHERE id = v_job.id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_action = 'extracted_text' THEN
    IF jsonb_typeof(p_payload->'text') <> 'string' THEN RAISE EXCEPTION 'Texto inválido'; END IF;
    UPDATE knowledge_document_versions SET extracted_text = left(p_payload->>'text', 2000000),
      extraction_status = 'done', page_count = NULLIF(p_payload->>'page_count', '')::integer
     WHERE id = v_job.version_id;
    UPDATE knowledge_documents SET search_text = left(p_payload->>'text', 100000)
     WHERE id = v_job.document_id AND current_version_id = v_job.version_id;
    UPDATE knowledge_index_jobs SET lease_expires_at = now() + interval '10 minutes' WHERE id = v_job.id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_action = 'submit_chunks' THEN
    v_model := p_payload->>'embedding_model';
    IF v_model IS NULL OR char_length(v_model) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Modelo inválido'; END IF;
    IF jsonb_typeof(p_payload->'chunks') <> 'array' OR jsonb_array_length(p_payload->'chunks') NOT BETWEEN 1 AND 64 THEN
      RAISE EXCEPTION 'Lote de fragmentos inválido';
    END IF;
    FOR v_chunk IN SELECT value FROM jsonb_array_elements(p_payload->'chunks') LOOP
      IF jsonb_typeof(v_chunk->'embedding') <> 'array' OR jsonb_array_length(v_chunk->'embedding') <> 384 THEN
        RAISE EXCEPTION 'Embedding inválido';
      END IF;
      INSERT INTO knowledge_chunks (user_id, document_id, version_id, job_id, chunk_index, content, section_path,
        page_from, page_to, token_estimate, content_hash, embedding, embedding_model)
      VALUES (p_owner_uid, v_job.document_id, v_job.version_id, v_job.id, (v_chunk->>'chunk_index')::integer,
        v_chunk->>'content', left(COALESCE(v_chunk->>'section_path', ''), 300),
        (v_chunk->>'page_from')::integer, (v_chunk->>'page_to')::integer,
        COALESCE((v_chunk->>'token_estimate')::integer, 0), v_chunk->>'content_hash',
        replace((v_chunk->'embedding')::text, ' ', '')::extensions.vector, v_model)
      ON CONFLICT (job_id, chunk_index) DO UPDATE SET content = EXCLUDED.content,
        section_path = EXCLUDED.section_path, page_from = EXCLUDED.page_from, page_to = EXCLUDED.page_to,
        token_estimate = EXCLUDED.token_estimate, content_hash = EXCLUDED.content_hash,
        embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model;
    END LOOP;
    UPDATE knowledge_index_jobs SET lease_expires_at = now() + interval '10 minutes' WHERE id = v_job.id;
    RETURN jsonb_build_object('ok', true, 'received', jsonb_array_length(p_payload->'chunks'));
  END IF;

  IF p_action = 'complete' THEN
    SELECT count(*) INTO v_count FROM knowledge_chunks WHERE job_id = v_job.id;
    IF v_count = 0 OR v_count <> COALESCE((p_payload->>'chunk_count')::integer, -1) THEN
      RAISE EXCEPTION 'Faltan fragmentos por enviar';
    END IF;
    UPDATE knowledge_index_jobs SET status = 'completed', completed_at = now(), worker_id = NULL, lease_expires_at = NULL,
      stats = COALESCE(p_payload->'stats', '{}'::jsonb) || jsonb_build_object('chunks', v_count, 'model', p_payload->>'embedding_model')
     WHERE id = v_job.id;
    SELECT * INTO v_doc FROM knowledge_documents WHERE id = v_job.document_id FOR UPDATE;
    IF v_doc.status = 'published' AND v_doc.rag_enabled AND v_doc.published_version_id = v_job.version_id THEN
      UPDATE knowledge_documents SET indexed_job_id = v_job.id, indexed_version_id = v_job.version_id,
        index_status = 'ready', index_error = NULL, last_indexed_at = now(), chunk_count = v_count
       WHERE id = v_doc.id;
      DELETE FROM knowledge_chunks WHERE document_id = v_doc.id AND job_id <> v_job.id;
      PERFORM knowledge_log(p_owner_uid, v_doc.id, 'indexed',
        jsonb_build_object('version_id', v_job.version_id, 'chunks', v_count, 'model', p_payload->>'embedding_model'));
    ELSE
      DELETE FROM knowledge_chunks WHERE job_id = v_job.id;
    END IF;
    RETURN jsonb_build_object('status', 'completed', 'chunks', v_count);
  END IF;

  IF p_action = 'fail' THEN
    IF jsonb_typeof(p_payload->'error') <> 'string' THEN RAISE EXCEPTION 'Error de tarea inválido'; END IF;
    v_failed := v_job.attempt_count >= 3 OR COALESCE((p_payload->>'retryable')::boolean, true) = false;
    UPDATE knowledge_index_jobs SET
      status = CASE WHEN v_failed THEN 'failed' ELSE 'pending' END,
      error = left(p_payload->>'error', 1000), worker_id = NULL, lease_expires_at = NULL,
      available_at = now() + v_job.attempt_count * interval '2 minutes',
      completed_at = CASE WHEN v_failed THEN now() END
     WHERE id = v_job.id RETURNING * INTO v_job;
    DELETE FROM knowledge_chunks WHERE job_id = v_job.id;
    IF v_failed THEN
      UPDATE knowledge_documents SET index_status = 'error', index_error = v_job.error
       WHERE id = v_job.document_id AND user_id = p_owner_uid;
      PERFORM knowledge_log(p_owner_uid, v_job.document_id, 'index_failed', jsonb_build_object('error', v_job.error));
    ELSE
      UPDATE knowledge_documents SET index_status = 'queued' WHERE id = v_job.document_id AND user_id = p_owner_uid;
    END IF;
    RETURN jsonb_build_object('status', v_job.status);
  END IF;

  IF p_action IN ('search_result', 'search_fail') THEN
    SELECT * INTO v_request FROM knowledge_search_requests
     WHERE id = (p_payload->>'request_id')::uuid AND user_id = p_owner_uid AND status = 'processing' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La búsqueda ya no está disponible'; END IF;
    IF p_action = 'search_fail' THEN
      UPDATE knowledge_search_requests SET status = 'failed', error = left(COALESCE(p_payload->>'error', 'Error'), 500),
        completed_at = now() WHERE id = v_request.id;
      RETURN jsonb_build_object('status', 'failed');
    END IF;
    IF jsonb_typeof(p_payload->'embedding') <> 'array' OR jsonb_array_length(p_payload->'embedding') <> 384 THEN
      RAISE EXCEPTION 'Embedding inválido';
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.score DESC), '[]'::jsonb) INTO v_results
    FROM knowledge_match_chunks(p_owner_uid, replace((p_payload->'embedding')::text, ' ', '')::extensions.vector,
      v_request.query, v_request.top_k, v_request.filters, p_payload->>'model') m;
    UPDATE knowledge_search_requests SET status = 'completed', results = v_results, completed_at = now()
     WHERE id = v_request.id;
    RETURN jsonb_build_object('status', 'completed', 'count', jsonb_array_length(v_results));
  END IF;

  RAISE EXCEPTION 'Operación de worker no permitida';
END;
$$;

-- ───────── Grants ─────────
REVOKE ALL ON FUNCTION
  public.knowledge_invalidate_index(uuid, uuid), public.knowledge_enqueue_index(uuid, uuid, text),
  public.knowledge_documents_index_sync(),
  public.knowledge_match_chunks(uuid, extensions.vector, text, integer, jsonb, text),
  public.knowledge_search_chunks_text(text, integer, jsonb), public.knowledge_request_search(text, jsonb, integer),
  public.knowledge_reindex_document(uuid), public.knowledge_reindex_all(boolean),
  public.knowledge_worker(text, uuid, uuid, uuid, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.knowledge_search_chunks_text(text, integer, jsonb), public.knowledge_request_search(text, jsonb, integer),
  public.knowledge_reindex_document(uuid), public.knowledge_reindex_all(boolean)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_worker(text, uuid, uuid, uuid, jsonb) TO service_role;

-- Backfill: documents already published before this migration.
SELECT public.knowledge_enqueue_index(user_id, id, 'backfill')
  FROM public.knowledge_documents
 WHERE status = 'published' AND rag_enabled AND published_version_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;

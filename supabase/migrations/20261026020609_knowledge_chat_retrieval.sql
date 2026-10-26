BEGIN;

CREATE TABLE public.knowledge_settings (
  user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_retrieval_enabled  boolean NOT NULL DEFAULT true,
  top_k                   integer NOT NULL DEFAULT 6 CHECK (top_k BETWEEN 1 AND 12),
  min_similarity          double precision NOT NULL DEFAULT 0 CHECK (min_similarity BETWEEN 0 AND 1),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_settings_read ON public.knowledge_settings FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
REVOKE ALL ON public.knowledge_settings FROM anon, authenticated;
GRANT SELECT ON public.knowledge_settings TO authenticated;

CREATE TABLE public.ai_job_knowledge_sources (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid NOT NULL,
  job_id          uuid NOT NULL,
  rank            integer NOT NULL CHECK (rank BETWEEN 1 AND 30),
  label           text NOT NULL CHECK (label ~ '^K[0-9]{1,2}$'),
  chunk_id        uuid,
  document_id     uuid NOT NULL,
  version_id      uuid,
  version_number  integer,
  title           text NOT NULL,
  section_path    text NOT NULL DEFAULT '',
  page_from       integer,
  page_to         integer,
  similarity      double precision,
  score           double precision NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, rank),
  FOREIGN KEY (user_id, job_id) REFERENCES public.ai_jobs(user_id, id) ON DELETE CASCADE
);
CREATE INDEX ai_job_knowledge_sources_owner_job_idx ON public.ai_job_knowledge_sources (user_id, job_id);
ALTER TABLE public.ai_job_knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_job_knowledge_sources_owner_read ON public.ai_job_knowledge_sources FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.ai_job_knowledge_sources FROM anon, authenticated;
GRANT SELECT ON public.ai_job_knowledge_sources TO authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_update_settings(
  p_chat_retrieval_enabled boolean,
  p_top_k integer,
  p_min_similarity double precision
)
RETURNS public.knowledge_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row knowledge_settings%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR EXISTS (
    SELECT 1 FROM collaborators WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Solo el propietario puede cambiar esta configuración';
  END IF;
  INSERT INTO knowledge_settings (user_id, chat_retrieval_enabled, top_k, min_similarity, updated_at)
  VALUES (v_actor, p_chat_retrieval_enabled, p_top_k, p_min_similarity, now())
  ON CONFLICT (user_id) DO UPDATE SET
    chat_retrieval_enabled = EXCLUDED.chat_retrieval_enabled,
    top_k = EXCLUDED.top_k,
    min_similarity = EXCLUDED.min_similarity,
    updated_at = now()
  RETURNING * INTO v_row;
  PERFORM knowledge_log(v_actor, NULL, 'settings_updated', to_jsonb(v_row) - 'user_id');
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_worker_retrieve(
  p_owner_uid uuid,
  p_worker_id uuid,
  p_job_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_settings knowledge_settings%ROWTYPE;
  v_top integer := 6;
  v_min double precision := 0;
  v_sources jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ai_jobs
    WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id
      AND status = 'processing' AND task_type = 'text_generation'
  ) THEN
    RAISE EXCEPTION 'La tarea no está reservada por este worker';
  END IF;
  SELECT * INTO v_settings FROM knowledge_settings WHERE user_id = p_owner_uid;
  IF FOUND THEN
    IF NOT v_settings.chat_retrieval_enabled THEN
      RETURN jsonb_build_object('enabled', false, 'sources', '[]'::jsonb);
    END IF;
    v_top := v_settings.top_k;
    v_min := v_settings.min_similarity;
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'embedding') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Embedding inválido';
  END IF;
  IF jsonb_array_length(p_payload->'embedding') <> 384 THEN
    RAISE EXCEPTION 'Embedding inválido';
  END IF;

  DELETE FROM ai_job_knowledge_sources WHERE job_id = p_job_id AND user_id = p_owner_uid;
  WITH matches AS (
    SELECT m.*, row_number() OVER (ORDER BY m.score DESC, m.similarity DESC NULLS LAST, m.chunk_id) AS rnk
    FROM knowledge_match_chunks(
      p_owner_uid,
      replace((p_payload->'embedding')::text, ' ', '')::extensions.vector,
      left(COALESCE(p_payload->>'query', ''), 500),
      v_top,
      '{}'::jsonb,
      p_payload->>'model'
    ) m
    WHERE m.similarity IS NULL OR m.similarity >= v_min
  ), inserted AS (
    INSERT INTO ai_job_knowledge_sources (
      user_id, job_id, rank, label, chunk_id, document_id, version_id,
      version_number, title, section_path, page_from, page_to, similarity, score
    )
    SELECT p_owner_uid, p_job_id, rnk, 'K' || rnk, chunk_id, document_id, version_id,
      version_number, title, section_path, page_from, page_to, similarity, score
    FROM matches
    RETURNING rank
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'label', 'K' || rnk,
    'document_id', document_id,
    'title', title,
    'version_number', version_number,
    'section_path', section_path,
    'page_from', page_from,
    'page_to', page_to,
    'content', content,
    'similarity', similarity,
    'score', score
  ) ORDER BY rnk), '[]'::jsonb)
  INTO v_sources FROM matches;
  RETURN jsonb_build_object('enabled', true, 'sources', v_sources);
END;
$$;

REVOKE ALL ON FUNCTION public.knowledge_update_settings(boolean, integer, double precision),
  public.knowledge_worker_retrieve(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_update_settings(boolean, integer, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_worker_retrieve(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

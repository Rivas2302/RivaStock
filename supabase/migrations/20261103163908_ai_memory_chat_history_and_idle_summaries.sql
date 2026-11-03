BEGIN;

CREATE OR REPLACE FUNCTION public.ai_memory_chat_index(
  p_owner uuid,
  p_worker uuid,
  p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_chat uuid;
  v_mode text := 'auto';
  v_chats jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION 'Solicitud de índice de chats inválida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;

  SELECT job.chat_id INTO v_current_chat
  FROM public.ai_jobs AS job
  WHERE job.id = p_job_id AND job.user_id = p_owner AND job.worker_id = p_worker
    AND job.status = 'processing' AND job.task_type = 'text_generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'La tarea no está reservada por este worker'; END IF;

  SELECT settings.mode INTO v_mode
  FROM public.ai_memory_settings AS settings
  WHERE settings.user_id = p_owner;
  IF v_mode = 'off' THEN RETURN jsonb_build_object('chats', '[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'title', recent.title,
    'last_message_at', recent.last_message_at,
    'first_questions', recent.first_questions,
    'summary', recent.summary
  ) ORDER BY recent.last_message_at DESC, recent.id), '[]'::jsonb)
  INTO v_chats
  FROM (
    SELECT chat.id, chat.title, chat.last_message_at,
      COALESCE((
        SELECT jsonb_agg(left(question.content, 400) ORDER BY question.created_at, question.id)
        FROM (
          SELECT message.id, message.content, message.created_at
          FROM public.ai_chat_messages AS message
          WHERE message.user_id = p_owner AND message.chat_id = chat.id AND message.role = 'user'
          ORDER BY message.created_at, message.id LIMIT 3
        ) AS question
      ), '[]'::jsonb) AS first_questions,
      (
        SELECT left(memory.content, 2000)
        FROM public.ai_memories AS memory
        WHERE memory.user_id = p_owner AND memory.source_chat_id = chat.id
          AND memory.kind = 'summary' AND memory.status = 'active'
        ORDER BY memory.updated_at DESC, memory.created_at DESC LIMIT 1
      ) AS summary
    FROM public.ai_chats AS chat
    WHERE chat.user_id = p_owner AND chat.id IS DISTINCT FROM v_current_chat
    ORDER BY chat.last_message_at DESC, chat.id
    LIMIT 8
  ) AS recent;

  RETURN jsonb_build_object('chats', v_chats);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_idle_summary_candidates(
  p_owner uuid,
  p_worker uuid,
  p_limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mode text := 'auto';
  v_candidate record;
  v_claimed_job uuid;
  v_exchanges jsonb;
  v_candidates jsonb := '[]'::jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Solicitud de resúmenes inactivos inválida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;

  SELECT settings.mode INTO v_mode
  FROM public.ai_memory_settings AS settings
  WHERE settings.user_id = p_owner;
  IF v_mode = 'off' THEN RETURN jsonb_build_object('candidates', '[]'::jsonb); END IF;

  FOR v_candidate IN
    SELECT chat.id AS chat_id, latest.id AS job_id
    FROM public.ai_chats AS chat
    JOIN LATERAL (
      SELECT job.id
      FROM public.ai_jobs AS job
      WHERE job.user_id = p_owner AND job.chat_id = chat.id
        AND job.task_type = 'text_generation' AND job.status = 'completed'
        AND EXISTS (SELECT 1 FROM public.ai_chat_messages AS message
          WHERE message.user_id = p_owner AND message.chat_id = chat.id
            AND message.job_id = job.id AND message.role = 'user')
        AND EXISTS (SELECT 1 FROM public.ai_chat_messages AS message
          WHERE message.user_id = p_owner AND message.chat_id = chat.id
            AND message.job_id = job.id AND message.role = 'assistant')
      ORDER BY job.completed_at DESC NULLS LAST, job.created_at DESC, job.id DESC
      LIMIT 1
    ) AS latest ON true
    WHERE chat.user_id = p_owner
      AND chat.last_message_at <= clock_timestamp() - interval '30 minutes'
      AND NOT EXISTS (SELECT 1 FROM public.ai_jobs AS active_job
        WHERE active_job.user_id = p_owner AND active_job.chat_id = chat.id
          AND active_job.status IN ('pending', 'processing'))
      AND NOT EXISTS (SELECT 1 FROM public.ai_memories AS summary
        WHERE summary.user_id = p_owner AND summary.source_chat_id = chat.id
          AND summary.kind = 'summary' AND summary.status IN ('active', 'proposed')
          AND summary.source_job_id = latest.id)
    ORDER BY chat.last_message_at, chat.id
    LIMIT p_limit
    FOR UPDATE OF chat SKIP LOCKED
  LOOP
    v_claimed_job := NULL;
    INSERT INTO public.ai_memory_job_claims (user_id, job_id, worker_id)
    VALUES (p_owner, v_candidate.job_id, p_worker)
    ON CONFLICT (user_id, job_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      expires_at = clock_timestamp() + interval '30 minutes'
    WHERE public.ai_memory_job_claims.expires_at <= clock_timestamp()
    RETURNING job_id INTO v_claimed_job;
    IF v_claimed_job IS NULL THEN CONTINUE; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'input', left(turn.user_content, 8000),
      'output', left(turn.assistant_content, 20000)
    ) ORDER BY turn.created_at, turn.job_id), '[]'::jsonb)
    INTO v_exchanges
    FROM (
      SELECT job.id AS job_id, job.created_at,
        user_message.content AS user_content,
        assistant_message.content AS assistant_content
      FROM public.ai_jobs AS job
      JOIN public.ai_chat_messages AS user_message
        ON user_message.user_id = p_owner AND user_message.chat_id = v_candidate.chat_id
        AND user_message.job_id = job.id AND user_message.role = 'user'
      JOIN public.ai_chat_messages AS assistant_message
        ON assistant_message.user_id = p_owner AND assistant_message.chat_id = v_candidate.chat_id
        AND assistant_message.job_id = job.id AND assistant_message.role = 'assistant'
      WHERE job.user_id = p_owner AND job.chat_id = v_candidate.chat_id
        AND job.task_type = 'text_generation' AND job.status = 'completed'
      ORDER BY job.created_at DESC, job.id DESC LIMIT 6
    ) AS turn;

    IF jsonb_array_length(v_exchanges) > 0 THEN
      v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
        'chat_id', v_candidate.chat_id,
        'job_id', v_candidate.job_id,
        'exchanges', v_exchanges
      ));
    ELSE
      DELETE FROM public.ai_memory_job_claims
      WHERE user_id = p_owner AND job_id = v_candidate.job_id AND worker_id = p_worker;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('candidates', v_candidates);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_memory_chat_index(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_memory_chat_index(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ai_memory_idle_summary_candidates(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_memory_idle_summary_candidates(uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.knowledge_worker_retrieve(
  p_owner_uid uuid,
  p_worker_id uuid,
  p_job_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings public.knowledge_settings%ROWTYPE;
  v_top integer := 6;
  v_min double precision := 0.75;
  v_sources jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id
      AND status = 'processing' AND task_type = 'text_generation'
  ) THEN
    RAISE EXCEPTION 'La tarea no está reservada por este worker';
  END IF;
  SELECT * INTO v_settings FROM public.knowledge_settings WHERE user_id = p_owner_uid;
  IF FOUND THEN
    IF NOT v_settings.chat_retrieval_enabled THEN
      RETURN jsonb_build_object('enabled', false, 'sources', '[]'::jsonb);
    END IF;
    v_top := v_settings.top_k;
    v_min := greatest(v_settings.min_similarity, 0.75);
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'embedding') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload->'embedding') <> 384 THEN
    RAISE EXCEPTION 'Embedding inválido';
  END IF;

  DELETE FROM public.ai_job_knowledge_sources WHERE job_id = p_job_id AND user_id = p_owner_uid;
  WITH matches AS (
    SELECT retrieved.*, row_number() OVER (
      ORDER BY retrieved.score DESC, retrieved.similarity DESC, retrieved.chunk_id
    ) AS rnk
    FROM public.knowledge_match_chunks(
      p_owner_uid,
      replace((p_payload->'embedding')::text, ' ', '')::extensions.vector,
      left(COALESCE(p_payload->>'query', ''), 500),
      v_top,
      '{}'::jsonb,
      p_payload->>'model'
    ) AS retrieved
    WHERE retrieved.similarity IS NOT NULL AND retrieved.similarity >= v_min
  ), inserted AS (
    INSERT INTO public.ai_job_knowledge_sources (
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

NOTIFY pgrst, 'reload schema';
COMMIT;

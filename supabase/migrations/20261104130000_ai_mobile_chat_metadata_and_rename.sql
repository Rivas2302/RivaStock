BEGIN;

ALTER TABLE public.ai_jobs
  ADD COLUMN chat_history_count smallint NOT NULL DEFAULT 0
  CHECK (chat_history_count BETWEEN 0 AND 8);

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

  UPDATE public.ai_jobs
  SET chat_history_count = jsonb_array_length(v_chats)
  WHERE id = p_job_id AND user_id = p_owner AND worker_id = p_worker
    AND status = 'processing' AND task_type = 'text_generation';
  IF NOT FOUND THEN RAISE EXCEPTION 'La tarea dejó de estar reservada'; END IF;

  RETURN jsonb_build_object('chats', v_chats);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_rename_chat(p_chat_id uuid, p_title text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[[:space:]]+', ' ', 'g'));
  v_chat_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar IA'; END IF;
  IF p_chat_id IS NULL THEN RAISE EXCEPTION 'Identificador de chat inválido'; END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'El título debe tener entre 1 y 80 caracteres';
  END IF;

  SELECT chat.id INTO v_chat_id
  FROM public.ai_chats AS chat
  WHERE chat.id = p_chat_id AND chat.user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el chat'; END IF;

  UPDATE public.ai_chats
  SET title = v_title, updated_at = now()
  WHERE id = v_chat_id AND user_id = v_actor;
  RETURN v_title;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_rename_chat(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_rename_chat(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

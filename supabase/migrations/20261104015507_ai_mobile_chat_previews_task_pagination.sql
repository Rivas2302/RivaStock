BEGIN;

ALTER TABLE public.ai_chats
  ADD COLUMN last_message_preview text
  CHECK (last_message_preview IS NULL OR char_length(last_message_preview) <= 140);

GRANT SELECT (last_message_preview) ON public.ai_chats TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_chat_preview(p_content text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT left(
    btrim(
      regexp_replace(
        translate(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                coalesce(p_content, ''),
                E'!\\[([^]]*)\\]\\([^)]*\\)', E'\\1', 'g'
              ),
              E'\\[([^]]+)\\]\\([^)]*\\)', E'\\1', 'g'
            ),
            E'(^|\\n)[[:space:]]*([-+]|[0-9]+\\.)[[:space:]]+', E'\\1', 'g'
          ),
          '*_~`#>|[]()!' || chr(92),
          ''
        ),
        '[[:space:]]+', ' ', 'g'
      )
    ),
    140
  )
$function$;

REVOKE ALL ON FUNCTION public.ai_chat_preview(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_chat_message_set_preview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.ai_chats
  SET last_message_preview = public.ai_chat_preview(NEW.content),
      last_message_at = GREATEST(last_message_at, NEW.created_at),
      updated_at = GREATEST(updated_at, NEW.created_at)
  WHERE id = NEW.chat_id
    AND user_id = NEW.user_id;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_chat_message_set_preview() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_chat_message_set_preview
AFTER INSERT ON public.ai_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.ai_chat_message_set_preview();

UPDATE public.ai_chats AS chat
SET last_message_preview = (
  SELECT public.ai_chat_preview(message.content)
  FROM public.ai_chat_messages AS message
  WHERE message.chat_id = chat.id
    AND message.user_id = chat.user_id
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM public.ai_chat_messages AS message
  WHERE message.chat_id = chat.id
    AND message.user_id = chat.user_id
);

CREATE OR REPLACE FUNCTION public.ai_recent_task_page(
  p_limit integer DEFAULT 10,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_limit integer := p_limit;
  v_recent_count bigint;
  v_regular_jobs jsonb := '[]'::jsonb;
  v_organize_jobs jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_created_at timestamptz;
  v_next_id uuid;
  v_all_count bigint;
  v_in_progress_count bigint;
  v_failed_count bigint;
  v_review_count bigint;
  v_finished_count bigint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_limit IS NULL OR p_limit < 10 OR p_limit > 50 THEN
    RAISE EXCEPTION 'El límite debe estar entre 10 y 50';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'El cursor de tareas está incompleto';
  END IF;

  SELECT count(*) INTO v_all_count
  FROM public.ai_jobs AS job
  WHERE job.user_id = v_actor
    AND job.chat_id IS NULL
    AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize');

  SELECT count(*) FILTER (WHERE job.status IN ('pending', 'processing')),
         count(*) FILTER (WHERE job.status = 'failed'),
         count(*) FILTER (WHERE job.status IN ('completed', 'failed')
           AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review'))
  INTO v_in_progress_count, v_failed_count, v_finished_count
  FROM public.ai_jobs AS job
  WHERE job.user_id = v_actor
    AND job.chat_id IS NULL
    AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize');

  SELECT count(*) INTO v_review_count
  FROM public.knowledge_ai_proposals AS proposal
  JOIN public.ai_jobs AS job
    ON job.id = proposal.job_id
   AND job.user_id = proposal.user_id
  WHERE proposal.user_id = v_actor
    AND proposal.status = 'pending'
    AND job.chat_id IS NULL
    AND job.task_type = 'knowledge_organize'
    AND job.status = 'completed'
    AND job.output IS NOT NULL;

  IF p_before_created_at IS NULL THEN
    SELECT count(*) INTO v_recent_count
    FROM public.ai_jobs AS job
    WHERE job.user_id = v_actor
      AND job.chat_id IS NULL
      AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize')
      AND job.created_at >= now() - interval '7 days';

    IF v_recent_count < 10 THEN
      v_limit := 10;
      WITH candidates AS (
        SELECT job.id, job.provider, job.task_type, job.input, job.output, job.status, job.error,
               job.created_at, job.started_at, job.completed_at, job.attempt_count,
               job.include_business_context, job.include_project_context, job.model_id, job.reasoning_effort
        FROM public.ai_jobs AS job
        WHERE job.user_id = v_actor
          AND job.chat_id IS NULL
          AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize')
        ORDER BY job.created_at DESC, job.id DESC
        LIMIT v_limit + 1
      ), page AS (
        SELECT * FROM candidates
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
      )
      SELECT
        coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
          FILTER (WHERE page.task_type <> 'knowledge_organize'), '[]'::jsonb),
        coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
          FILTER (WHERE page.task_type = 'knowledge_organize'), '[]'::jsonb),
        (SELECT count(*) > v_limit FROM candidates),
        (SELECT created_at FROM page ORDER BY created_at ASC, id ASC LIMIT 1),
        (SELECT id FROM page ORDER BY created_at ASC, id ASC LIMIT 1)
      INTO v_regular_jobs, v_organize_jobs, v_has_more, v_next_created_at, v_next_id
      FROM page;
    ELSE
      WITH candidates AS (
        SELECT job.id, job.provider, job.task_type, job.input, job.output, job.status, job.error,
               job.created_at, job.started_at, job.completed_at, job.attempt_count,
               job.include_business_context, job.include_project_context, job.model_id, job.reasoning_effort
        FROM public.ai_jobs AS job
        WHERE job.user_id = v_actor
          AND job.chat_id IS NULL
          AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize')
          AND job.created_at >= now() - interval '7 days'
        ORDER BY job.created_at DESC, job.id DESC
        LIMIT v_limit + 1
      ), page AS (
        SELECT * FROM candidates
        ORDER BY created_at DESC, id DESC
        LIMIT v_limit
      )
      SELECT
        coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
          FILTER (WHERE page.task_type <> 'knowledge_organize'), '[]'::jsonb),
        coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
          FILTER (WHERE page.task_type = 'knowledge_organize'), '[]'::jsonb),
        (SELECT count(*) > v_limit FROM candidates),
        (SELECT created_at FROM page ORDER BY created_at ASC, id ASC LIMIT 1),
        (SELECT id FROM page ORDER BY created_at ASC, id ASC LIMIT 1)
      INTO v_regular_jobs, v_organize_jobs, v_has_more, v_next_created_at, v_next_id
      FROM page;
    END IF;
  ELSE
    WITH candidates AS (
      SELECT job.id, job.provider, job.task_type, job.input, job.output, job.status, job.error,
             job.created_at, job.started_at, job.completed_at, job.attempt_count,
             job.include_business_context, job.include_project_context, job.model_id, job.reasoning_effort
      FROM public.ai_jobs AS job
      WHERE job.user_id = v_actor
        AND job.chat_id IS NULL
        AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize')
        AND (job.created_at, job.id) < (p_before_created_at, p_before_id)
      ORDER BY job.created_at DESC, job.id DESC
      LIMIT v_limit + 1
    ), page AS (
      SELECT * FROM candidates
      ORDER BY created_at DESC, id DESC
      LIMIT v_limit
    )
    SELECT
      coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
        FILTER (WHERE page.task_type <> 'knowledge_organize'), '[]'::jsonb),
      coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC)
        FILTER (WHERE page.task_type = 'knowledge_organize'), '[]'::jsonb),
      (SELECT count(*) > v_limit FROM candidates),
      (SELECT created_at FROM page ORDER BY created_at ASC, id ASC LIMIT 1),
      (SELECT id FROM page ORDER BY created_at ASC, id ASC LIMIT 1)
    INTO v_regular_jobs, v_organize_jobs, v_has_more, v_next_created_at, v_next_id
    FROM page;
  END IF;

  IF NOT v_has_more AND v_next_created_at IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ai_jobs AS job
      WHERE job.user_id = v_actor
        AND job.chat_id IS NULL
        AND job.task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize')
        AND (job.created_at, job.id) < (v_next_created_at, v_next_id)
    ) INTO v_has_more;
  END IF;

  RETURN jsonb_build_object(
    'jobs', v_regular_jobs,
    'knowledge_organize_jobs', v_organize_jobs,
    'finished_task_count', v_finished_count,
    'counts', jsonb_build_object(
      'all', v_all_count,
      'in_progress', v_in_progress_count,
      'failed', v_failed_count,
      'knowledge_review', v_review_count
    ),
    'has_more', v_has_more,
    'next_before', CASE WHEN v_has_more AND v_next_created_at IS NOT NULL
      THEN jsonb_build_object('created_at', v_next_created_at, 'id', v_next_id)
      ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ai_retry_job(p_job_id uuid, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_original public.ai_jobs%ROWTYPE;
  v_existing public.ai_jobs%ROWTYPE;
  v_retry public.ai_jobs%ROWTYPE;
  v_proposal public.knowledge_ai_proposals%ROWTYPE;
  v_pending_count integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede reintentar tareas'; END IF;
  IF p_job_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Identificador de tarea inválido';
  END IF;

  SELECT * INTO v_original
  FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la tarea'; END IF;
  IF v_original.status <> 'failed' OR v_original.chat_id IS NOT NULL
    OR v_original.task_type NOT IN ('text_generation', 'fb_copywriting', 'fb_photo_review', 'knowledge_organize') THEN
    RAISE EXCEPTION 'Solo se pueden reintentar tareas fallidas independientes';
  END IF;

  IF v_original.task_type = 'knowledge_organize' THEN
    SELECT * INTO v_proposal
    FROM public.knowledge_ai_proposals
    WHERE user_id = v_actor AND job_id = v_original.id AND status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La propuesta de Conocimientos ya se resolvió o no existe'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));

  SELECT * INTO v_existing
  FROM public.ai_jobs
  WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.id = v_original.id
      OR v_existing.task_type IS DISTINCT FROM v_original.task_type
      OR v_existing.provider IS DISTINCT FROM v_original.provider
      OR v_existing.input IS DISTINCT FROM v_original.input
      OR v_existing.include_business_context IS DISTINCT FROM v_original.include_business_context
      OR v_existing.include_project_context IS DISTINCT FROM v_original.include_project_context
      OR v_existing.model_id IS DISTINCT FROM v_original.model_id
      OR v_existing.reasoning_effort IS DISTINCT FROM v_original.reasoning_effort THEN
      RAISE EXCEPTION 'La clave de reintento ya se usó con otros datos';
    END IF;
    RETURN jsonb_build_object('job', to_jsonb(v_existing));
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.ai_jobs
  WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO public.ai_jobs (
    user_id, idempotency_key, provider, task_type, input,
    include_business_context, include_project_context, model_id, reasoning_effort
  ) VALUES (
    v_actor, p_idempotency_key, v_original.provider, v_original.task_type, v_original.input,
    v_original.include_business_context, v_original.include_project_context,
    v_original.model_id, v_original.reasoning_effort
  ) RETURNING * INTO v_retry;

  IF v_original.task_type = 'knowledge_organize' THEN
    UPDATE public.knowledge_ai_proposals
    SET job_id = v_retry.id
    WHERE id = v_proposal.id AND user_id = v_actor;
  END IF;

  RETURN jsonb_build_object('job', to_jsonb(v_retry));
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_recent_task_page(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_recent_task_page(integer, timestamptz, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ai_retry_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_retry_job(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

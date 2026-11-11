BEGIN;

ALTER TABLE public.ai_jobs
  ADD COLUMN cancel_requested_at timestamptz;

CREATE TABLE public.ai_job_stream (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL,
  seq integer NOT NULL DEFAULT 0 CHECK (seq >= 0),
  text text NOT NULL DEFAULT '' CHECK (char_length(text) <= 20000),
  activity jsonb NOT NULL DEFAULT '{"kind":"thinking","label":"Preparando la respuesta…"}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, job_id) REFERENCES public.ai_jobs(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, chat_id) REFERENCES public.ai_chats(user_id, id) ON DELETE CASCADE
);

ALTER TABLE public.ai_job_stream ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_job_stream_owner_select ON public.ai_job_stream
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.ai_job_stream FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_job_stream TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_job_stream_upsert(
  p_owner uuid,
  p_worker_id uuid,
  p_job_id uuid,
  p_seq integer,
  p_text text,
  p_activity jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_kind text;
  v_label text;
BEGIN
  IF p_owner IS NULL OR p_worker_id IS NULL OR p_job_id IS NULL OR p_seq IS NULL OR p_seq < 1
    OR p_text IS NULL OR char_length(p_text) > 20000
    OR p_activity IS NULL OR jsonb_typeof(p_activity) <> 'object' THEN
    RAISE EXCEPTION 'Actualización de conversación inválida';
  END IF;

  v_kind := p_activity->>'kind';
  v_label := p_activity->>'label';
  IF v_kind IS NULL OR v_kind NOT IN ('thinking', 'searching_web', 'tool', 'writing')
    OR v_label IS NULL OR octet_length(v_label) > 300
    OR (p_activity ? 'tool' AND (jsonb_typeof(p_activity->'tool') <> 'string'
      OR octet_length(p_activity->>'tool') > 80 OR p_activity->'tool' = 'null'::jsonb))
    OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_activity) AS activity_key
      WHERE activity_key NOT IN ('kind', 'label', 'tool')
    ) THEN
    RAISE EXCEPTION 'Actividad de conversación inválida';
  END IF;

  SELECT * INTO v_job
  FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = p_owner AND worker_id = p_worker_id
    AND status = 'processing' AND task_type = 'text_generation' AND chat_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La tarea no pertenece a este worker'; END IF;

  INSERT INTO public.ai_job_stream (job_id, user_id, chat_id, seq, text, activity, updated_at)
  VALUES (v_job.id, v_job.user_id, v_job.chat_id, p_seq, p_text, p_activity, now())
  ON CONFLICT (job_id) DO UPDATE SET
    seq = EXCLUDED.seq,
    text = EXCLUDED.text,
    activity = EXCLUDED.activity,
    updated_at = EXCLUDED.updated_at
  WHERE public.ai_job_stream.seq < EXCLUDED.seq;

  UPDATE public.ai_jobs SET lease_expires_at = now() + interval '3 minutes'
  WHERE id = v_job.id AND user_id = p_owner AND worker_id = p_worker_id AND status = 'processing';

  RETURN v_job.cancel_requested_at IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_job_stream_upsert(uuid, uuid, uuid, integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_job_stream_upsert(uuid, uuid, uuid, integer, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ai_cancel_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.ai_jobs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_job_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_job FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = auth.uid()
    AND task_type = 'text_generation' AND chat_id IS NOT NULL
    AND status IN ('pending', 'processing')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_job.status = 'pending' THEN
    UPDATE public.ai_jobs SET status = 'failed', error = 'Cancelado por el usuario',
      completed_at = now(), worker_id = NULL, lease_expires_at = NULL,
      cancel_requested_at = now()
    WHERE id = v_job.id AND user_id = v_job.user_id AND status = 'pending';
  ELSE
    UPDATE public.ai_jobs SET cancel_requested_at = COALESCE(cancel_requested_at, now())
    WHERE id = v_job.id AND user_id = v_job.user_id AND status = 'processing';
  END IF;

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('source', 'ai_jobs', 'job_id', v_job.id),
      'pending_work', 'bridge:' || v_job.user_id::text, true
    );
  EXCEPTION WHEN OTHERS THEN
    -- Polling remains the bounded fallback when Realtime is unavailable.
    NULL;
  END;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_cancel_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_cancel_job(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_bridge_claim_chat_text_job(p_owner uuid, p_worker_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device public.ai_bridge_devices%ROWTYPE;
  v_active_count integer;
  v_active_chat uuid;
  v_job public.ai_jobs%ROWTYPE;
BEGIN
  IF p_owner IS NULL OR p_worker_id IS NULL THEN RAISE EXCEPTION 'Worker inválido'; END IF;
  SELECT * INTO v_device FROM public.ai_bridge_devices
  WHERE id = p_worker_id AND user_id = p_owner AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.ai_bridge_devices WHERE user_id = p_owner AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'Computadora desvinculada';
    END IF;
    RETURN NULL;
  END IF;
  IF v_device.update_requested IS TRUE THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_active_count FROM public.ai_jobs
  WHERE user_id = p_owner AND worker_id = p_worker_id AND status = 'processing'
    AND lease_expires_at > now();
  IF v_active_count <> 1 THEN RETURN NULL; END IF;

  SELECT chat_id INTO v_active_chat FROM public.ai_jobs
  WHERE user_id = p_owner AND worker_id = p_worker_id AND status = 'processing'
    AND lease_expires_at > now() AND task_type = 'text_generation' AND chat_id IS NOT NULL
  ORDER BY started_at, id LIMIT 1;
  IF v_active_chat IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_job FROM public.ai_jobs AS job
  WHERE job.user_id = p_owner AND job.task_type = 'text_generation' AND job.chat_id IS NOT NULL
    AND job.chat_id <> v_active_chat AND job.attempt_count < 3
    AND (job.status = 'pending' OR (job.status = 'processing' AND job.lease_expires_at <= now()))
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_jobs AS other
      WHERE other.user_id = p_owner AND other.chat_id = job.chat_id
        AND other.status IN ('pending','processing') AND other.id <> job.id
    )
  ORDER BY job.created_at, job.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.ai_jobs SET status = 'processing', worker_id = p_worker_id,
    lease_expires_at = now() + interval '3 minutes', started_at = COALESCE(started_at, now()),
    attempt_count = attempt_count + 1, error = NULL, cancel_requested_at = NULL
  WHERE id = v_job.id AND user_id = p_owner
  RETURNING * INTO v_job;

  UPDATE public.ai_bridge_devices SET state = 'busy',
    current_job_id = COALESCE(v_device.current_job_id, v_job.id), last_seen_at = now()
  WHERE id = p_worker_id AND user_id = p_owner AND revoked_at IS NULL;
  RETURN jsonb_build_object(
    'id', v_job.id, 'provider', v_job.provider, 'task_type', v_job.task_type,
    'input', v_job.input, 'attempt_count', v_job.attempt_count,
    'created_at', v_job.created_at, 'chat_id', v_job.chat_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ai_bridge_claim_chat_text_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_bridge_claim_chat_text_job(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_bridge_finish_chat_job(
  p_owner uuid,
  p_worker_id uuid,
  p_job_id uuid,
  p_success boolean,
  p_output text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_next_job uuid;
BEGIN
  IF p_success IS NULL OR p_owner IS NULL OR p_worker_id IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_success AND (p_output IS NULL OR char_length(btrim(p_output)) NOT BETWEEN 1 AND 20000) THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF NOT p_success AND (p_error IS NULL OR char_length(btrim(p_error)) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'Error de tarea inválido';
  END IF;
  IF p_session_id IS NOT NULL AND p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$' THEN
    RAISE EXCEPTION 'Identificador de sesión inválido';
  END IF;

  SELECT * INTO v_job FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = p_owner AND worker_id = p_worker_id
    AND status = 'processing' AND task_type = 'text_generation' AND chat_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La tarea ya no está reservada por este worker'; END IF;
  IF p_success AND v_job.provider <> 'mock' AND p_session_id IS NULL THEN
    RAISE EXCEPTION 'Actualizá el AI Bridge para continuar este chat';
  END IF;

  IF p_success THEN
    UPDATE public.ai_jobs SET status = 'completed', output = p_output, error = NULL,
      completed_at = now(), worker_id = NULL, lease_expires_at = NULL
    WHERE id = v_job.id AND user_id = p_owner;
    IF p_session_id IS NOT NULL THEN
      UPDATE public.ai_chats SET provider_session_id = p_session_id
      WHERE id = v_job.chat_id AND user_id = p_owner;
    END IF;
    INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
    VALUES (p_owner, v_job.chat_id, v_job.id, 'assistant', btrim(p_output))
    ON CONFLICT (job_id, role) DO NOTHING;
    UPDATE public.ai_chats SET updated_at = now(), last_message_at = now()
    WHERE id = v_job.chat_id AND user_id = p_owner;
  ELSE
    UPDATE public.ai_jobs SET status = 'failed', error = left(p_error, 1000), completed_at = now(),
      worker_id = NULL, lease_expires_at = NULL
    WHERE id = v_job.id AND user_id = p_owner;
  END IF;

  SELECT id INTO v_next_job FROM public.ai_jobs
  WHERE user_id = p_owner AND worker_id = p_worker_id AND status = 'processing'
    AND lease_expires_at > now()
  ORDER BY started_at, id LIMIT 1;
  UPDATE public.ai_bridge_devices SET state = CASE WHEN v_next_job IS NULL THEN 'idle' ELSE 'busy' END,
    current_job_id = v_next_job, last_seen_at = now()
  WHERE id = p_worker_id AND user_id = p_owner AND revoked_at IS NULL;
  UPDATE public.ai_bridge_workers SET state = CASE WHEN v_next_job IS NULL THEN 'idle' ELSE 'busy' END,
    current_job_id = v_next_job, last_seen_at = now()
  WHERE user_id = p_owner AND worker_id = p_worker_id;

  RETURN jsonb_build_object('id', v_job.id, 'status', CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    'completed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.ai_bridge_finish_chat_job(uuid, uuid, uuid, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_bridge_finish_chat_job(uuid, uuid, uuid, boolean, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ai_job_stream_cleanup_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('completed', 'failed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.ai_job_stream WHERE job_id = NEW.id AND user_id = NEW.user_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_job_stream_cleanup_terminal() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ai_job_stream_cleanup_terminal
  AFTER UPDATE OF status ON public.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.ai_job_stream_cleanup_terminal();

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_job_stream';
  EXCEPTION
    WHEN duplicate_object OR undefined_object OR undefined_table OR insufficient_privilege THEN NULL;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

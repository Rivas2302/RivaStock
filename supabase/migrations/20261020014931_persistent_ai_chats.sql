BEGIN;

CREATE TABLE ai_chats (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('mock', 'codex', 'claude')),
  title                 text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  model_id              text,
  reasoning_effort      text,
  provider_session_id   text CHECK (
    provider_session_id IS NULL OR provider_session_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$'
  ),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_message_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  CHECK (
    (provider = 'codex' AND model_id IS NOT NULL
      AND model_id IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra')
      AND reasoning_effort IS NOT NULL
      AND reasoning_effort IN ('low', 'medium', 'high', 'xhigh'))
    OR (provider <> 'codex' AND model_id IS NULL AND reasoning_effort IS NULL)
  )
);

ALTER TABLE ai_jobs
  ADD COLUMN chat_id uuid,
  ADD CONSTRAINT ai_jobs_user_id_id_key UNIQUE (user_id, id),
  ADD CONSTRAINT ai_jobs_chat_owner_fkey
    FOREIGN KEY (user_id, chat_id) REFERENCES ai_chats(user_id, id) ON DELETE CASCADE;

CREATE INDEX ai_chats_owner_recent_idx ON ai_chats (user_id, last_message_at DESC);
CREATE INDEX ai_jobs_chat_pending_idx ON ai_jobs (user_id, chat_id, status)
  WHERE chat_id IS NOT NULL AND status IN ('pending', 'processing');

CREATE TABLE ai_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id     uuid NOT NULL,
  job_id      uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, chat_id) REFERENCES ai_chats(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, job_id) REFERENCES ai_jobs(user_id, id) ON DELETE CASCADE,
  UNIQUE (job_id, role),
  CHECK (
    (role = 'user' AND char_length(content) BETWEEN 1 AND 8000)
    OR (role = 'assistant' AND char_length(content) BETWEEN 1 AND 20000)
  )
);

CREATE INDEX ai_chat_messages_owner_chat_created_idx
  ON ai_chat_messages (user_id, chat_id, created_at, id);

ALTER TABLE ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_chats_owner_select ON ai_chats
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY ai_chat_messages_owner_select ON ai_chat_messages
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON ai_chats, ai_chat_messages FROM anon, authenticated;
GRANT SELECT (id, user_id, provider, title, model_id, reasoning_effort, created_at, updated_at, last_message_at)
  ON ai_chats TO authenticated;
GRANT SELECT ON ai_chat_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_send_chat_message(
  p_idempotency_key uuid,
  p_provider text,
  p_input text,
  p_include_business_context boolean DEFAULT false,
  p_include_project_context boolean DEFAULT false,
  p_model_id text DEFAULT NULL,
  p_reasoning_effort text DEFAULT NULL,
  p_chat_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_chat public.ai_chats%ROWTYPE;
  v_job public.ai_jobs%ROWTYPE;
  v_pending_count integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar el módulo IA'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('mock', 'codex', 'claude') THEN
    RAISE EXCEPTION 'Proveedor no permitido';
  END IF;
  IF p_input IS NULL OR char_length(p_input) NOT BETWEEN 1 AND 8000
    OR p_input ~ '^[[:space:]]*$' THEN
    RAISE EXCEPTION 'El mensaje debe tener entre 1 y 8000 caracteres';
  END IF;
  IF p_include_business_context IS NULL OR p_include_project_context IS NULL THEN
    RAISE EXCEPTION 'Opciones de contexto inválidas';
  END IF;
  IF p_provider = 'codex' AND (
    p_model_id IS NULL OR p_model_id NOT IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra')
    OR p_reasoning_effort IS NULL OR p_reasoning_effort NOT IN ('low', 'medium', 'high', 'xhigh')
  ) THEN RAISE EXCEPTION 'Modelo o nivel de razonamiento inválido'; END IF;
  IF p_provider <> 'codex' AND (p_model_id IS NOT NULL OR p_reasoning_effort IS NOT NULL) THEN
    RAISE EXCEPTION 'La configuración enviada no corresponde al proveedor';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));

  SELECT * INTO v_job FROM public.ai_jobs
  WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_job.chat_id IS NULL
      OR (p_chat_id IS NOT NULL AND v_job.chat_id IS DISTINCT FROM p_chat_id)
      OR v_job.provider <> p_provider OR v_job.input <> p_input
      OR v_job.include_business_context <> (p_provider <> 'mock' AND p_include_business_context)
      OR v_job.include_project_context <> (p_provider <> 'mock' AND p_include_project_context)
      OR v_job.model_id IS DISTINCT FROM p_model_id
      OR v_job.reasoning_effort IS DISTINCT FROM p_reasoning_effort THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otro mensaje';
    END IF;
    RETURN jsonb_build_object('chat_id', v_job.chat_id, 'job', to_jsonb(v_job));
  END IF;

  IF p_chat_id IS NULL THEN
    INSERT INTO public.ai_chats (user_id, provider, title, model_id, reasoning_effort)
    VALUES (
      v_actor,
      p_provider,
      left(btrim(regexp_replace(p_input, '[[:space:]]+', ' ', 'g')), 80),
      p_model_id,
      p_reasoning_effort
    )
    RETURNING * INTO v_chat;
  ELSE
    SELECT * INTO v_chat FROM public.ai_chats
    WHERE id = p_chat_id AND user_id = v_actor
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el chat'; END IF;
    IF v_chat.provider <> p_provider OR v_chat.model_id IS DISTINCT FROM p_model_id
      OR v_chat.reasoning_effort IS DISTINCT FROM p_reasoning_effort THEN
      RAISE EXCEPTION 'La configuración de este chat no se puede cambiar';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.ai_jobs
      WHERE user_id = v_actor AND chat_id = v_chat.id AND status IN ('pending', 'processing')
    ) THEN RAISE EXCEPTION 'Esperá a que termine la respuesta antes de enviar otro mensaje'; END IF;
  END IF;

  SELECT count(*) INTO v_pending_count FROM public.ai_jobs
  WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO public.ai_jobs (
    user_id, idempotency_key, provider, input, include_business_context,
    include_project_context, model_id, reasoning_effort, chat_id
  ) VALUES (
    v_actor, p_idempotency_key, p_provider, p_input,
    p_provider <> 'mock' AND p_include_business_context,
    p_provider <> 'mock' AND p_include_project_context,
    p_model_id, p_reasoning_effort, v_chat.id
  ) RETURNING * INTO v_job;

  INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
  VALUES (v_actor, v_chat.id, v_job.id, 'user', p_input);

  UPDATE public.ai_chats SET updated_at = now(), last_message_at = now()
  WHERE id = v_chat.id AND user_id = v_actor;

  RETURN jsonb_build_object('chat_id', v_chat.id, 'job', to_jsonb(v_job));
END;
$$;

REVOKE ALL ON FUNCTION public.ai_send_chat_message(uuid, text, text, boolean, boolean, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_send_chat_message(uuid, text, text, boolean, boolean, text, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_bridge_worker(
  p_action text,
  p_owner_uid uuid,
  p_worker_id uuid,
  p_job_id uuid DEFAULT NULL,
  p_result jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response jsonb;
  v_state text;
  v_current_job_id uuid;
  v_chat_id uuid;
  v_session_id text;
  v_output text;
  v_provider text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE user_id = p_owner_uid AND revoked_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;

  IF p_action = 'complete' AND p_result ? 'session_id' THEN
    IF jsonb_typeof(p_result->'session_id') <> 'string'
      OR (p_result->>'session_id') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$' THEN
      RAISE EXCEPTION 'Identificador de sesión inválido';
    END IF;
  END IF;

  IF p_action = 'complete' THEN
    SELECT chat_id, provider INTO v_chat_id, v_provider
    FROM public.ai_jobs
    WHERE id = p_job_id AND user_id = p_owner_uid
      AND worker_id = p_worker_id AND status = 'processing';
    IF v_chat_id IS NOT NULL AND v_provider <> 'mock' AND NOT (p_result ? 'session_id') THEN
      RAISE EXCEPTION 'Actualizá el AI Bridge para continuar este chat';
    END IF;
  END IF;

  v_response := public.ai_bridge_worker_legacy(p_action, p_owner_uid, p_worker_id, p_job_id, p_result);

  IF p_action = 'complete' AND v_response->>'status' = 'completed' THEN
    SELECT chat_id, output INTO v_chat_id, v_output
    FROM public.ai_jobs WHERE id = p_job_id AND user_id = p_owner_uid;
    IF v_chat_id IS NOT NULL THEN
      v_session_id := p_result->>'session_id';
      IF v_session_id IS NOT NULL THEN
        UPDATE public.ai_chats SET provider_session_id = v_session_id
        WHERE id = v_chat_id AND user_id = p_owner_uid;
      END IF;

      INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
      VALUES (p_owner_uid, v_chat_id, p_job_id, 'assistant', v_output)
      ON CONFLICT (job_id, role) DO NOTHING;

      UPDATE public.ai_chats SET updated_at = now(), last_message_at = now()
      WHERE id = v_chat_id AND user_id = p_owner_uid;
    END IF;
  END IF;

  IF p_action = 'heartbeat' THEN
    v_state := COALESCE(p_result->>'state', 'idle');
    v_current_job_id := p_job_id;
  ELSIF p_action = 'claim' AND v_response IS NOT NULL THEN
    v_state := 'busy';
    v_current_job_id := (v_response->>'id')::uuid;
  ELSE
    v_state := 'idle';
    v_current_job_id := NULL;
  END IF;

  UPDATE public.ai_bridge_devices
    SET state = v_state, current_job_id = v_current_job_id, last_seen_at = now()
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_bridge_worker(text, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_bridge_worker(text, uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

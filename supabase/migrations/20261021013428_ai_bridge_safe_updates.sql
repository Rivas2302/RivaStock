BEGIN;

ALTER TABLE public.ai_bridge_devices
  ADD COLUMN update_requested boolean NOT NULL DEFAULT false;

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
  v_update_requested boolean;
  v_device_state text;
  v_device_job_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE user_id = p_owner_uid AND revoked_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;

  SELECT update_requested, state, current_job_id
    INTO v_update_requested, v_device_state, v_device_job_id
    FROM public.ai_bridge_devices
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL
    FOR UPDATE;

  IF p_action = 'prepare_update' THEN
    IF v_update_requested IS NULL THEN
      RAISE EXCEPTION 'No se pudo preparar una actualización segura para esta PC';
    END IF;
    IF v_update_requested OR (v_device_state = 'idle' AND v_device_job_id IS NULL) THEN
      UPDATE public.ai_bridge_devices
        SET update_requested = true, last_seen_at = now()
        WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL;
      RETURN jsonb_build_object('ready', true, 'state', 'idle');
    END IF;
    RETURN jsonb_build_object('ready', false, 'state', v_device_state);
  END IF;

  IF p_action = 'start' THEN
    IF v_update_requested IS NOT NULL THEN
      UPDATE public.ai_bridge_devices
        SET update_requested = false, state = 'idle', current_job_id = NULL, last_seen_at = now()
        WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL;
    END IF;
    RETURN jsonb_build_object('started', true);
  END IF;

  IF p_action = 'claim' AND v_update_requested = true THEN
    UPDATE public.ai_bridge_devices
      SET state = 'idle', current_job_id = NULL, last_seen_at = now()
      WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL;
    RETURN jsonb_build_object('__update_requested', true);
  END IF;

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

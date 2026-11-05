BEGIN;

CREATE OR REPLACE FUNCTION public.bridge_pending_work(
  p_worker uuid,
  p_token text,
  p_legacy_owner uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF p_legacy_owner IS NULL THEN
    v_owner := public.ai_bridge_authorize_device(p_worker, p_token);
  ELSE
    IF EXISTS (SELECT 1 FROM public.ai_bridge_devices AS device WHERE device.user_id = p_legacy_owner) THEN
      RAISE EXCEPTION 'Computadora desvinculada';
    END IF;
    v_owner := p_legacy_owner;
  END IF;

  RETURN jsonb_build_object(
    'ai_jobs',
      EXISTS (SELECT 1 FROM public.ai_jobs AS job
        WHERE job.user_id = v_owner AND job.status = 'pending')
      OR EXISTS (SELECT 1 FROM public.ai_bridge_devices AS device
        WHERE device.id = p_worker AND device.user_id = v_owner AND device.update_requested IS TRUE),
    'knowledge',
      EXISTS (SELECT 1 FROM public.knowledge_index_jobs AS job
        WHERE job.user_id = v_owner AND (
          (job.status = 'pending' AND job.available_at <= now())
          OR (job.status = 'processing' AND job.lease_expires_at <= now())
        ))
      OR EXISTS (SELECT 1 FROM public.knowledge_search_requests AS request
        WHERE request.user_id = v_owner AND request.status = 'pending'),
    'supervisor',
      EXISTS (SELECT 1 FROM public.fb_supervision_requests AS request
        WHERE request.user_id = v_owner AND request.status = 'pending'
          AND request.created_at > now() - interval '120 seconds'),
    'central_requests',
      EXISTS (SELECT 1 FROM public.knowledge_file_requests AS request
        WHERE request.user_id = v_owner AND (
          (request.status = 'pending' AND request.expires_at > now())
          OR (request.status = 'uploading' AND request.claimed_at < now() - interval '5 minutes'
              AND request.expires_at > now())
          OR (request.status IN ('pending', 'uploading', 'ready', 'failed') AND request.expires_at <= now())
          OR (request.status = 'expired' AND request.cache_path IS NOT NULL)
        )),
    'central_store',
      EXISTS (SELECT 1 FROM public.knowledge_document_versions AS version
        JOIN public.knowledge_documents AS document
          ON document.id = version.document_id AND document.user_id = version.user_id
        WHERE version.user_id = v_owner AND version.storage_location = 'cloud'
          AND version.storage_path IS NOT NULL AND version.cloud_purged_at IS NULL
          AND document.status <> 'deleting')
      OR EXISTS (SELECT 1 FROM public.knowledge_central_deletions AS deletion
        WHERE deletion.user_id = v_owner AND deletion.done_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.knowledge_document_versions AS version
        WHERE version.user_id = v_owner AND version.storage_location = 'local'
          AND version.cloud_purge_after < now() AND version.local_verified_at > now() - interval '24 hours'
          AND version.cloud_purged_at IS NULL),
    'memory_embeddings',
      EXISTS (SELECT 1 FROM public.ai_memories AS memory
        WHERE memory.user_id = v_owner AND memory.status = 'active' AND memory.embedding IS NULL
          AND (memory.kind IN ('fact', 'summary') OR (memory.kind = 'preference' AND NOT memory.pinned))),
    'idle_summary',
      COALESCE((SELECT settings.mode <> 'off' FROM public.ai_memory_settings AS settings
        WHERE settings.user_id = v_owner), true)
      AND EXISTS (
        SELECT 1
        FROM public.ai_chats AS chat
        JOIN LATERAL (
          SELECT job.id
          FROM public.ai_jobs AS job
          WHERE job.user_id = v_owner AND job.chat_id = chat.id
            AND job.task_type = 'text_generation' AND job.status = 'completed'
            AND EXISTS (SELECT 1 FROM public.ai_chat_messages AS message
              WHERE message.user_id = v_owner AND message.chat_id = chat.id
                AND message.job_id = job.id AND message.role = 'user')
            AND EXISTS (SELECT 1 FROM public.ai_chat_messages AS message
              WHERE message.user_id = v_owner AND message.chat_id = chat.id
                AND message.job_id = job.id AND message.role = 'assistant')
          ORDER BY job.completed_at DESC NULLS LAST, job.created_at DESC, job.id DESC
          LIMIT 1
        ) AS latest ON true
        WHERE chat.user_id = v_owner AND chat.last_message_at <= now() - interval '30 minutes'
          AND NOT EXISTS (SELECT 1 FROM public.ai_jobs AS active_job
            WHERE active_job.user_id = v_owner AND active_job.chat_id = chat.id
              AND active_job.status IN ('pending', 'processing'))
          AND NOT EXISTS (SELECT 1 FROM public.ai_memories AS summary
            WHERE summary.user_id = v_owner AND summary.source_chat_id = chat.id
              AND summary.kind = 'summary' AND summary.status IN ('active', 'proposed')
              AND summary.source_job_id = latest.id)
          AND NOT EXISTS (SELECT 1 FROM public.ai_memory_job_claims AS claim
            WHERE claim.user_id = v_owner AND claim.job_id = latest.id AND claim.expires_at > now())
      ),
    'chat_tombstones',
      EXISTS (SELECT 1 FROM public.ai_chat_tombstones AS tombstone
        WHERE tombstone.user_id = v_owner AND tombstone.cleaned_at IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_pending_work(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_pending_work(uuid, text, uuid) TO service_role;

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
    IF v_device_state = 'idle' AND v_device_job_id IS NULL THEN
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

  IF p_action = 'claim' AND jsonb_typeof(v_response) = 'object' AND v_response ? 'id' THEN
    v_current_job_id := (v_response->>'id')::uuid;
    UPDATE public.ai_jobs SET lease_expires_at = now() + interval '3 minutes'
    WHERE id = v_current_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing';
  ELSIF p_action = 'heartbeat' AND p_job_id IS NOT NULL THEN
    UPDATE public.ai_jobs SET lease_expires_at = now() + interval '3 minutes'
    WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing';
  END IF;

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

CREATE OR REPLACE FUNCTION public.ai_bridge_wakeup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_owner := OLD.user_id;
  ELSE
    v_owner := NEW.user_id;
  END IF;
  IF v_owner IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('source', TG_TABLE_NAME),
        'pending_work',
        'bridge:' || v_owner::text,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      -- A wakeup is an optimization; the bounded polling fallback must remain safe.
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_bridge_wakeup() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_jobs_bridge_wakeup
  AFTER INSERT OR UPDATE OF status ON public.ai_jobs
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER ai_workspace_files_bridge_wakeup
  AFTER INSERT OR UPDATE OR DELETE ON public.ai_workspace_files
  FOR EACH ROW EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER knowledge_index_jobs_bridge_wakeup
  AFTER INSERT OR UPDATE OF status ON public.knowledge_index_jobs
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER knowledge_search_requests_bridge_wakeup
  AFTER INSERT ON public.knowledge_search_requests
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER fb_supervision_requests_bridge_wakeup
  AFTER INSERT ON public.fb_supervision_requests
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER knowledge_file_requests_bridge_wakeup
  AFTER INSERT ON public.knowledge_file_requests
  FOR EACH ROW WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER knowledge_document_versions_bridge_wakeup
  AFTER INSERT ON public.knowledge_document_versions
  FOR EACH ROW WHEN (NEW.storage_location = 'cloud' AND NEW.storage_path IS NOT NULL)
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER knowledge_central_deletions_bridge_wakeup
  AFTER INSERT ON public.knowledge_central_deletions
  FOR EACH ROW WHEN (NEW.done_at IS NULL)
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER ai_memories_bridge_wakeup
  AFTER INSERT OR UPDATE OF embedding ON public.ai_memories
  FOR EACH ROW WHEN (NEW.embedding IS NULL AND NEW.status = 'active')
  EXECUTE FUNCTION public.ai_bridge_wakeup();

CREATE TRIGGER ai_chat_tombstones_bridge_wakeup
  AFTER INSERT ON public.ai_chat_tombstones
  FOR EACH ROW WHEN (NEW.cleaned_at IS NULL)
  EXECUTE FUNCTION public.ai_bridge_wakeup();

NOTIFY pgrst, 'reload schema';

COMMIT;

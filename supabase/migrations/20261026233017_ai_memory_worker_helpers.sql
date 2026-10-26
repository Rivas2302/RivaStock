BEGIN;

CREATE OR REPLACE FUNCTION public.ai_memory_touch_similar(
  p_owner uuid,
  p_worker uuid,
  p_job_id uuid,
  p_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_job_id IS NULL
    OR p_ids IS NULL OR cardinality(p_ids) > 8 THEN
    RAISE EXCEPTION 'Solicitud de actualización de memoria inválida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_memory_job_claims
    WHERE user_id = p_owner AND job_id = p_job_id AND worker_id = p_worker AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'La tarea de memoria ya no está reservada por este worker';
  END IF;
  UPDATE public.ai_memories
  SET last_used_at = clock_timestamp()
  WHERE user_id = p_owner AND id = ANY(p_ids) AND status = 'active';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_chat_summary(
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
  v_chat_id uuid;
  v_summary jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_job_id IS NULL THEN
    RAISE EXCEPTION 'Solicitud de resumen de memoria inválida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  SELECT job.chat_id INTO v_chat_id
  FROM public.ai_jobs AS job
  WHERE job.id = p_job_id AND job.user_id = p_owner AND job.task_type = 'text_generation'
    AND job.chat_id IS NOT NULL AND job.status IN ('processing', 'completed')
    AND (job.worker_id = p_worker OR EXISTS (
      SELECT 1 FROM public.ai_memory_job_claims AS claim
      WHERE claim.user_id = p_owner AND claim.job_id = p_job_id
        AND claim.worker_id = p_worker AND claim.expires_at > now()
    ));
  IF v_chat_id IS NULL THEN RAISE EXCEPTION 'La tarea de memoria ya no está reservada por este worker'; END IF;

  SELECT jsonb_build_object(
    'id', memory.id, 'kind', memory.kind, 'content', memory.content, 'pinned', memory.pinned,
    'source_chat_id', memory.source_chat_id, 'source_job_id', memory.source_job_id,
    'similarity', NULL, 'use_count', memory.use_count, 'created_at', memory.created_at
  ) INTO v_summary
  FROM public.ai_memories AS memory
  WHERE memory.user_id = p_owner AND memory.source_chat_id = v_chat_id
    AND memory.kind = 'summary' AND memory.status = 'active'
  ORDER BY memory.updated_at DESC, memory.created_at DESC LIMIT 1;
  RETURN jsonb_build_object('summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_memory_touch_similar(uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_memory_touch_similar(uuid, uuid, uuid, uuid[])
  TO service_role;
REVOKE ALL ON FUNCTION public.ai_memory_chat_summary(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_memory_chat_summary(uuid, uuid, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

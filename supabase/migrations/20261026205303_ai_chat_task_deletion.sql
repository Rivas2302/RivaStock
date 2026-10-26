BEGIN;

CREATE TABLE public.ai_chat_tombstones (
  chat_id    uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('mock', 'codex', 'claude')),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  cleaned_at timestamptz
);
CREATE INDEX ai_chat_tombstones_pending_idx
  ON public.ai_chat_tombstones (user_id, deleted_at)
  WHERE cleaned_at IS NULL;
ALTER TABLE public.ai_chat_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_chat_tombstones FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.ai_history_settings (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  retention_days    integer CHECK (retention_days IS NULL OR retention_days IN (30, 90, 180, 365)),
  last_retention_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_history_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_history_settings_owner_read ON public.ai_history_settings
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.collaborators
      WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
    )
  );
REVOKE ALL ON public.ai_history_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_history_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_delete_chat(p_chat_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_provider text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar IA'; END IF;
  IF p_chat_id IS NULL THEN RAISE EXCEPTION 'Identificador de chat inválido'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT provider INTO v_provider
  FROM public.ai_chats
  WHERE id = p_chat_id AND user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el chat'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE user_id = v_actor AND chat_id = p_chat_id
      AND status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'Esperá a que termine la respuesta antes de borrar el chat';
  END IF;

  INSERT INTO public.ai_chat_tombstones (chat_id, user_id, provider)
  VALUES (p_chat_id, v_actor, v_provider)
  ON CONFLICT (chat_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    provider = EXCLUDED.provider,
    deleted_at = now(),
    cleaned_at = NULL;

  DELETE FROM public.ai_chats WHERE id = p_chat_id AND user_id = v_actor;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_delete_task(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_chat_id uuid;
  v_task_type text;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar IA'; END IF;
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Identificador de tarea inválido'; END IF;

  SELECT chat_id, task_type, status INTO v_chat_id, v_task_type, v_status
  FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la tarea'; END IF;
  IF v_chat_id IS NOT NULL OR v_task_type <> 'text_generation' THEN
    RAISE EXCEPTION 'Solo se pueden borrar tareas puntuales de texto';
  END IF;
  IF v_status IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Esperá a que termine la tarea antes de borrarla';
  END IF;

  DELETE FROM public.ai_jobs WHERE id = p_job_id AND user_id = v_actor;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_delete_all_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar IA'; END IF;

  DELETE FROM public.ai_jobs
  WHERE user_id = v_actor AND chat_id IS NULL
    AND task_type = 'text_generation' AND status IN ('completed', 'failed');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_update_history_settings(p_retention_days integer)
RETURNS public.ai_history_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_settings public.ai_history_settings%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede cambiar la retención'; END IF;
  IF p_retention_days IS NOT NULL AND p_retention_days NOT IN (30, 90, 180, 365) THEN
    RAISE EXCEPTION 'Período de retención inválido';
  END IF;

  INSERT INTO public.ai_history_settings (user_id, retention_days, updated_at)
  VALUES (v_actor, p_retention_days, now())
  ON CONFLICT (user_id) DO UPDATE SET
    retention_days = EXCLUDED.retention_days,
    updated_at = now()
  RETURNING * INTO v_settings;
  RETURN v_settings;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_apply_history_retention(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings public.ai_history_settings%ROWTYPE;
  v_cutoff timestamptz;
  v_deleted_chats integer := 0;
  v_deleted_tasks integer := 0;
BEGIN
  IF p_owner IS NULL THEN RAISE EXCEPTION 'Propietario inválido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_owner::text));

  SELECT * INTO v_settings
  FROM public.ai_history_settings
  WHERE user_id = p_owner
  FOR UPDATE;
  IF NOT FOUND OR v_settings.retention_days IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'deleted_chats', 0, 'deleted_tasks', 0);
  END IF;
  IF v_settings.last_retention_at >= now() - interval '6 hours' THEN
    RETURN jsonb_build_object('applied', false, 'deleted_chats', 0, 'deleted_tasks', 0);
  END IF;

  UPDATE public.ai_history_settings SET last_retention_at = now()
  WHERE user_id = p_owner;
  v_cutoff := now() - make_interval(days => v_settings.retention_days);

  INSERT INTO public.ai_chat_tombstones (chat_id, user_id, provider)
  SELECT chat.id, chat.user_id, chat.provider
  FROM public.ai_chats AS chat
  WHERE chat.user_id = p_owner AND chat.last_message_at < v_cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_jobs AS job
      WHERE job.user_id = p_owner AND job.chat_id = chat.id
        AND job.status IN ('pending', 'processing')
    )
  ON CONFLICT (chat_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    provider = EXCLUDED.provider,
    deleted_at = now(),
    cleaned_at = NULL;

  DELETE FROM public.ai_chats AS chat
  WHERE chat.user_id = p_owner AND chat.last_message_at < v_cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_jobs AS job
      WHERE job.user_id = p_owner AND job.chat_id = chat.id
        AND job.status IN ('pending', 'processing')
    );
  GET DIAGNOSTICS v_deleted_chats = ROW_COUNT;

  DELETE FROM public.ai_jobs
  WHERE user_id = p_owner AND chat_id IS NULL
    AND task_type = 'text_generation'
    AND status IN ('completed', 'failed') AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;

  RETURN jsonb_build_object(
    'applied', true,
    'deleted_chats', v_deleted_chats,
    'deleted_tasks', v_deleted_tasks
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_bridge_chat_tombstones(
  p_owner uuid,
  p_worker uuid,
  p_operation text,
  p_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_acknowledged integer := 0;
  v_tombstones jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL THEN RAISE EXCEPTION 'Worker inválido'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;

  IF p_operation = 'list' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(batch)), '[]'::jsonb) INTO v_tombstones
    FROM (
      SELECT chat_id, provider, deleted_at
      FROM public.ai_chat_tombstones
      WHERE user_id = p_owner AND cleaned_at IS NULL
      ORDER BY deleted_at, chat_id
      LIMIT 50
    ) AS batch;
    RETURN jsonb_build_object('tombstones', v_tombstones);
  END IF;

  IF p_operation <> 'ack' THEN RAISE EXCEPTION 'Operación de lápida inválida'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Lista de lápidas inválida';
  END IF;
  UPDATE public.ai_chat_tombstones
  SET cleaned_at = now()
  WHERE user_id = p_owner AND chat_id = ANY(p_ids) AND cleaned_at IS NULL;
  GET DIAGNOSTICS v_acknowledged = ROW_COUNT;
  RETURN jsonb_build_object('acknowledged', v_acknowledged);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_delete_chat(uuid), public.ai_delete_task(uuid),
  public.ai_delete_all_tasks(), public.ai_update_history_settings(integer),
  public.ai_apply_history_retention(uuid), public.ai_bridge_chat_tombstones(uuid, uuid, text, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_delete_chat(uuid), public.ai_delete_task(uuid),
  public.ai_delete_all_tasks(), public.ai_update_history_settings(integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_apply_history_retention(uuid),
  public.ai_bridge_chat_tombstones(uuid, uuid, text, uuid[])
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

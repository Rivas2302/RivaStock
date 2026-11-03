BEGIN;

CREATE OR REPLACE FUNCTION public.knowledge_delete_organize_task(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_task_type text;
  v_chat_id uuid;
  v_status text;
  v_proposal_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar IA'; END IF;
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Identificador de tarea inválido'; END IF;

  SELECT task_type, chat_id, status INTO v_task_type, v_chat_id, v_status
  FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la tarea'; END IF;
  IF v_task_type <> 'knowledge_organize' OR v_chat_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo se pueden borrar tareas de Organizar con IA';
  END IF;
  IF v_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Esperá a que termine la tarea antes de borrarla';
  END IF;

  SELECT status INTO v_proposal_status
  FROM public.knowledge_ai_proposals
  WHERE user_id = v_actor AND job_id = p_job_id
  FOR UPDATE;
  IF v_proposal_status = 'pending' THEN
    RAISE EXCEPTION 'Primero resolvé o descartá la propuesta antes de borrar la tarea';
  END IF;

  DELETE FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = v_actor AND task_type = 'knowledge_organize';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.knowledge_delete_organize_task(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_delete_organize_task(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

BEGIN;

ALTER TABLE public.ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_task_type_check;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_task_type_check
  CHECK (task_type IN ('text_generation', 'knowledge_organize'));

CREATE TABLE public.knowledge_ai_proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL,
  job_id       uuid NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded')),
  image_map    jsonb NOT NULL DEFAULT '{}'::jsonb
               CHECK (jsonb_typeof(image_map) = 'object' AND octet_length(image_map::text) <= 20000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  FOREIGN KEY (user_id, document_id) REFERENCES public.knowledge_documents(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, job_id) REFERENCES public.ai_jobs(user_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_ai_proposals_doc_idx
  ON public.knowledge_ai_proposals (user_id, document_id, created_at DESC);

ALTER TABLE public.knowledge_ai_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_ai_proposals_owner_read ON public.knowledge_ai_proposals FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.knowledge_ai_proposals FROM anon, authenticated;
GRANT SELECT ON public.knowledge_ai_proposals TO authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_request_organize(
  p_document_id uuid,
  p_idempotency_key uuid,
  p_provider text,
  p_input text,
  p_model_id text DEFAULT NULL,
  p_reasoning_effort text DEFAULT NULL,
  p_image_map jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_job ai_jobs%ROWTYPE;
  v_proposal knowledge_ai_proposals%ROWTYPE;
  v_pending integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede usar el módulo IA';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_documents WHERE id = p_document_id AND user_id = v_actor
                 AND kind = 'editor' AND status NOT IN ('archived', 'deleting')) THEN
    RAISE EXCEPTION 'Documento no disponible';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('mock', 'codex', 'claude') THEN
    RAISE EXCEPTION 'Proveedor no permitido';
  END IF;
  IF p_input IS NULL OR char_length(p_input) NOT BETWEEN 1 AND 8000 OR p_input ~ '^[[:space:]]*$' THEN
    RAISE EXCEPTION 'Las notas deben tener entre 1 y 8000 caracteres';
  END IF;
  IF p_provider = 'codex' AND (
    p_model_id IS NULL OR p_model_id NOT IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra')
    OR p_reasoning_effort IS NULL OR p_reasoning_effort NOT IN ('low', 'medium', 'high', 'xhigh')
  ) THEN RAISE EXCEPTION 'Modelo o nivel de razonamiento inválido'; END IF;
  IF p_provider <> 'codex' AND (p_model_id IS NOT NULL OR p_reasoning_effort IS NOT NULL) THEN
    RAISE EXCEPTION 'La configuración enviada no corresponde al proveedor';
  END IF;
  IF p_image_map IS NULL OR jsonb_typeof(p_image_map) <> 'object'
    OR octet_length(p_image_map::text) > 20000 THEN
    RAISE EXCEPTION 'Imágenes inválidas';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_job FROM ai_jobs WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_proposal FROM knowledge_ai_proposals WHERE job_id = v_job.id;
    IF NOT FOUND OR v_job.task_type <> 'knowledge_organize' OR v_job.input <> p_input
      OR v_job.provider <> p_provider OR v_job.model_id IS DISTINCT FROM p_model_id
      OR v_job.reasoning_effort IS DISTINCT FROM p_reasoning_effort
      OR v_proposal.document_id <> p_document_id OR v_proposal.image_map IS DISTINCT FROM p_image_map THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otros datos';
    END IF;
    RETURN jsonb_build_object('job', to_jsonb(v_job), 'proposal_id', v_proposal.id);
  END IF;

  SELECT count(*) INTO v_pending FROM ai_jobs
   WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO ai_jobs (user_id, idempotency_key, provider, task_type, input,
    include_business_context, include_project_context, model_id, reasoning_effort)
  VALUES (v_actor, p_idempotency_key, p_provider, 'knowledge_organize', p_input,
    false, false, p_model_id, p_reasoning_effort)
  RETURNING * INTO v_job;
  INSERT INTO knowledge_ai_proposals (user_id, document_id, job_id, image_map)
  VALUES (v_actor, p_document_id, v_job.id, p_image_map)
  RETURNING * INTO v_proposal;
  PERFORM knowledge_log(v_actor, p_document_id, 'ai_organize_requested',
    jsonb_build_object('job_id', v_job.id, 'provider', p_provider));
  RETURN jsonb_build_object('job', to_jsonb(v_job), 'proposal_id', v_proposal.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_resolve_proposal(p_proposal_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal knowledge_ai_proposals%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('applied', 'discarded') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE knowledge_ai_proposals SET status = p_status, resolved_at = now()
   WHERE id = p_proposal_id AND user_id = auth.uid() AND status = 'pending'
  RETURNING * INTO v_proposal;
  IF NOT FOUND THEN RAISE EXCEPTION 'Propuesta inexistente o ya resuelta'; END IF;
  PERFORM knowledge_log(v_proposal.user_id, v_proposal.document_id,
    CASE WHEN p_status = 'applied' THEN 'ai_proposal_applied' ELSE 'ai_proposal_discarded' END,
    jsonb_build_object('job_id', v_proposal.job_id));
END;
$$;

REVOKE ALL ON FUNCTION public.knowledge_request_organize(uuid, uuid, text, text, text, text, jsonb),
  public.knowledge_resolve_proposal(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_request_organize(uuid, uuid, text, text, text, text, jsonb),
  public.knowledge_resolve_proposal(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

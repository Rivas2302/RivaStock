-- Persist the Codex model and reasoning effort selected for each generation job.
ALTER TABLE ai_jobs
  ADD COLUMN model_id text,
  ADD COLUMN reasoning_effort text;

ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_jobs_model_id_check
    CHECK (model_id IS NULL OR model_id IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra')),
  ADD CONSTRAINT ai_jobs_reasoning_effort_check
    CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high'));

CREATE OR REPLACE FUNCTION ai_create_job_with_model(
  p_idempotency_key uuid,
  p_provider text,
  p_input text,
  p_include_business_context boolean,
  p_include_project_context boolean,
  p_model_id text DEFAULT NULL,
  p_reasoning_effort text DEFAULT NULL
)
RETURNS ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_job ai_jobs%ROWTYPE;
  v_pending_count integer;
  v_model_id text;
  v_reasoning_effort text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar el módulo IA'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  IF p_provider NOT IN ('mock', 'codex', 'claude') THEN RAISE EXCEPTION 'Proveedor no permitido'; END IF;
  IF p_input IS NULL OR char_length(p_input) NOT BETWEEN 1 AND 8000 OR btrim(p_input) = '' THEN
    RAISE EXCEPTION 'La instrucción debe tener entre 1 y 8000 caracteres';
  END IF;

  v_model_id := CASE WHEN p_provider = 'codex' THEN COALESCE(p_model_id, 'gpt-6-luna') ELSE NULL END;
  v_reasoning_effort := CASE WHEN p_provider = 'codex' THEN COALESCE(p_reasoning_effort, 'low') ELSE NULL END;
  IF v_model_id NOT IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra') THEN RAISE EXCEPTION 'Modelo de Codex no permitido'; END IF;
  IF v_reasoning_effort NOT IN ('low', 'medium', 'high') THEN RAISE EXCEPTION 'Nivel de razonamiento no permitido'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_job FROM ai_jobs
    WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_job.provider <> p_provider OR v_job.input <> p_input
      OR v_job.include_business_context <> p_include_business_context
      OR v_job.include_project_context <> p_include_project_context
      OR v_job.model_id IS DISTINCT FROM v_model_id
      OR v_job.reasoning_effort IS DISTINCT FROM v_reasoning_effort THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otros datos';
    END IF;
    RETURN v_job;
  END IF;

  SELECT count(*) INTO v_pending_count FROM ai_jobs
    WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO ai_jobs (
    user_id, idempotency_key, provider, input,
    include_business_context, include_project_context,
    model_id, reasoning_effort
  )
  VALUES (
    v_actor, p_idempotency_key, p_provider, p_input,
    p_include_business_context, p_include_project_context,
    v_model_id, v_reasoning_effort
  )
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION ai_create_job_with_model(uuid, text, text, boolean, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_create_job_with_model(uuid, text, text, boolean, boolean, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 0076_ai_bridge.sql
-- Tenant-scoped text generation jobs for the local RivaStock AI Bridge.

CREATE TABLE ai_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key   uuid NOT NULL,
  provider          text NOT NULL CHECK (provider IN ('mock', 'codex', 'claude')),
  task_type         text NOT NULL DEFAULT 'text_generation' CHECK (task_type = 'text_generation'),
  input             text NOT NULL CHECK (char_length(input) BETWEEN 1 AND 8000 AND btrim(input) <> ''),
  output            text CHECK (output IS NULL OR char_length(output) <= 20000),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error             text CHECK (error IS NULL OR char_length(error) <= 1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz,
  attempt_count     integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  worker_id         uuid,
  lease_expires_at  timestamptz,
  UNIQUE (user_id, idempotency_key),
  CHECK ((status = 'processing') = (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('completed', 'failed')) = (completed_at IS NOT NULL))
);

CREATE INDEX ai_jobs_owner_created_idx ON ai_jobs (user_id, created_at DESC);
CREATE INDEX ai_jobs_claim_idx ON ai_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE ai_bridge_workers (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_id        uuid NOT NULL,
  state            text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'busy')),
  current_job_id   uuid REFERENCES ai_jobs(id) ON DELETE SET NULL,
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_bridge_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_jobs_owner_read ON ai_jobs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ai_bridge_workers_owner_read ON ai_bridge_workers
  FOR SELECT USING (user_id = auth.uid());

REVOKE ALL ON ai_jobs FROM anon, authenticated;
REVOKE ALL ON ai_bridge_workers FROM anon, authenticated;
GRANT SELECT ON ai_jobs, ai_bridge_workers TO authenticated;

CREATE OR REPLACE FUNCTION ai_create_job(
  p_idempotency_key uuid,
  p_provider text,
  p_input text
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

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_job FROM ai_jobs
    WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_job.provider <> p_provider OR v_job.input <> p_input THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otra instrucción';
    END IF;
    RETURN v_job;
  END IF;

  SELECT count(*) INTO v_pending_count FROM ai_jobs
    WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO ai_jobs (user_id, idempotency_key, provider, input)
  VALUES (v_actor, p_idempotency_key, p_provider, p_input)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION ai_create_job(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_create_job(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION ai_bridge_worker(
  p_action text,
  p_owner_uid uuid,
  p_worker_id uuid,
  p_job_id uuid DEFAULT NULL,
  p_result jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job ai_jobs%ROWTYPE;
  v_worker ai_bridge_workers%ROWTYPE;
  v_new_state text;
BEGIN
  IF p_owner_uid IS NULL OR p_worker_id IS NULL THEN RAISE EXCEPTION 'Worker inválido'; END IF;

  IF p_action = 'heartbeat' THEN
    v_new_state := COALESCE(p_result->>'state', 'idle');
    IF v_new_state NOT IN ('idle', 'busy') THEN RAISE EXCEPTION 'Estado de worker inválido'; END IF;
    IF (v_new_state = 'busy') <> (p_job_id IS NOT NULL) THEN RAISE EXCEPTION 'Estado de worker inconsistente'; END IF;
    IF p_job_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ai_jobs
      WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing'
    ) THEN RAISE EXCEPTION 'La tarea no pertenece a este worker'; END IF;

    INSERT INTO ai_bridge_workers (user_id, worker_id, state, current_job_id, last_seen_at)
    VALUES (p_owner_uid, p_worker_id, v_new_state, p_job_id, now())
    ON CONFLICT (user_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      state = EXCLUDED.state,
      current_job_id = EXCLUDED.current_job_id,
      last_seen_at = EXCLUDED.last_seen_at
    RETURNING * INTO v_worker;

    IF p_job_id IS NOT NULL THEN
      UPDATE ai_jobs SET lease_expires_at = now() + interval '90 seconds'
      WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing';
    END IF;
    RETURN jsonb_build_object('state', v_worker.state, 'last_seen_at', v_worker.last_seen_at);
  END IF;

  IF p_action = 'claim' THEN
    INSERT INTO ai_bridge_workers (user_id, worker_id, state, last_seen_at)
    VALUES (p_owner_uid, p_worker_id, 'idle', now())
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_worker FROM ai_bridge_workers WHERE user_id = p_owner_uid FOR UPDATE;
    UPDATE ai_bridge_workers SET worker_id = p_worker_id, last_seen_at = now()
      WHERE user_id = p_owner_uid;

    UPDATE ai_jobs SET status = 'failed', error = 'La PC se desconectó antes de completar la tarea.',
      completed_at = now(), worker_id = NULL, lease_expires_at = NULL
    WHERE user_id = p_owner_uid AND status = 'processing'
      AND lease_expires_at <= now() AND attempt_count >= 3;

    IF EXISTS (
      SELECT 1 FROM ai_jobs WHERE user_id = p_owner_uid AND status = 'processing'
        AND lease_expires_at > now()
    ) THEN
      UPDATE ai_bridge_workers SET state = 'busy',
        current_job_id = (SELECT id FROM ai_jobs WHERE user_id = p_owner_uid AND status = 'processing' AND lease_expires_at > now() ORDER BY started_at LIMIT 1)
      WHERE user_id = p_owner_uid;
      RETURN NULL;
    END IF;

    SELECT * INTO v_job FROM ai_jobs
    WHERE user_id = p_owner_uid AND attempt_count < 3
      AND (status = 'pending' OR (status = 'processing' AND lease_expires_at <= now()))
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN
      UPDATE ai_bridge_workers SET state = 'idle', current_job_id = NULL, last_seen_at = now()
      WHERE user_id = p_owner_uid;
      RETURN NULL;
    END IF;

    UPDATE ai_jobs SET status = 'processing', worker_id = p_worker_id,
      lease_expires_at = now() + interval '90 seconds', started_at = COALESCE(started_at, now()),
      attempt_count = attempt_count + 1, error = NULL
    WHERE id = v_job.id RETURNING * INTO v_job;
    UPDATE ai_bridge_workers SET state = 'busy', current_job_id = v_job.id, last_seen_at = now()
    WHERE user_id = p_owner_uid;

    RETURN jsonb_build_object(
      'id', v_job.id, 'provider', v_job.provider, 'task_type', v_job.task_type,
      'input', v_job.input, 'attempt_count', v_job.attempt_count, 'created_at', v_job.created_at
    );
  END IF;

  IF p_action = 'complete' THEN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
      OR jsonb_typeof(p_result->'output') <> 'string'
      OR char_length(p_result->>'output') NOT BETWEEN 1 AND 20000 THEN
      RAISE EXCEPTION 'Resultado inválido';
    END IF;
    UPDATE ai_jobs SET status = 'completed', output = p_result->>'output', error = NULL,
      completed_at = now(), worker_id = NULL, lease_expires_at = NULL
    WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing'
    RETURNING * INTO v_job;
    IF NOT FOUND THEN RAISE EXCEPTION 'La tarea ya no está reservada por este worker'; END IF;
    UPDATE ai_bridge_workers SET state = 'idle', current_job_id = NULL, last_seen_at = now()
    WHERE user_id = p_owner_uid AND worker_id = p_worker_id;
    RETURN jsonb_build_object('id', v_job.id, 'status', v_job.status, 'completed_at', v_job.completed_at);
  END IF;

  IF p_action = 'fail' THEN
    IF jsonb_typeof(p_result) <> 'object' OR jsonb_typeof(p_result->'error') <> 'string' THEN
      RAISE EXCEPTION 'Error de tarea inválido';
    END IF;
    UPDATE ai_jobs SET status = 'failed', error = left(p_result->>'error', 1000), completed_at = now(),
      worker_id = NULL, lease_expires_at = NULL
    WHERE id = p_job_id AND user_id = p_owner_uid AND worker_id = p_worker_id AND status = 'processing'
    RETURNING * INTO v_job;
    IF NOT FOUND THEN RAISE EXCEPTION 'La tarea ya no está reservada por este worker'; END IF;
    UPDATE ai_bridge_workers SET state = 'idle', current_job_id = NULL, last_seen_at = now()
    WHERE user_id = p_owner_uid AND worker_id = p_worker_id;
    RETURN jsonb_build_object('id', v_job.id, 'status', v_job.status, 'completed_at', v_job.completed_at);
  END IF;

  RAISE EXCEPTION 'Operación de worker no permitida';
END;
$$;

REVOKE ALL ON FUNCTION ai_bridge_worker(text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_bridge_worker(text, uuid, uuid, uuid, jsonb) TO service_role;

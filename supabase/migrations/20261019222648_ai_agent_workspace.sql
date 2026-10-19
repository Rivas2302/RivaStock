-- Owner-managed text knowledge and skills synchronized to the local AI Bridge.

ALTER TABLE ai_jobs
  ADD COLUMN include_business_context boolean NOT NULL DEFAULT false,
  ADD COLUMN include_project_context boolean NOT NULL DEFAULT false;

CREATE TABLE ai_workspace_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path        text NOT NULL CHECK (
    char_length(path) BETWEEN 1 AND 240
    AND path ~ '^(skills|knowledge)/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*\.(md|txt|json|yaml|yml|toml)$'
  ),
  content     text NOT NULL CHECK (char_length(content) <= 65536),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, path)
);

CREATE INDEX ai_workspace_files_owner_path_idx ON ai_workspace_files (user_id, path);

CREATE OR REPLACE FUNCTION ai_workspace_file_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_file_count integer;
  v_total_bytes bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  SELECT count(*)::integer, COALESCE(sum(octet_length(content)), 0)::bigint
    INTO v_file_count, v_total_bytes
    FROM ai_workspace_files
   WHERE user_id = NEW.user_id
     AND id IS DISTINCT FROM NEW.id;

  IF v_file_count >= 100 THEN
    RAISE EXCEPTION 'La biblioteca admite hasta 100 archivos';
  END IF;
  IF v_total_bytes + octet_length(NEW.content) > 1048576 THEN
    RAISE EXCEPTION 'La biblioteca no puede superar 1 MiB';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_workspace_files_enforce_limits
  BEFORE INSERT OR UPDATE OF user_id, content ON ai_workspace_files
  FOR EACH ROW EXECUTE FUNCTION ai_workspace_file_limits();

CREATE OR REPLACE FUNCTION ai_workspace_files_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_workspace_files_touch_updated_at
  BEFORE UPDATE ON ai_workspace_files
  FOR EACH ROW EXECUTE FUNCTION ai_workspace_files_touch_updated_at();

ALTER TABLE ai_workspace_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_workspace_files_owner_select ON ai_workspace_files
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = auth.uid() AND revoked_at IS NULL
    )
  );

CREATE POLICY ai_workspace_files_owner_insert ON ai_workspace_files
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = auth.uid() AND revoked_at IS NULL
    )
  );

CREATE POLICY ai_workspace_files_owner_update ON ai_workspace_files
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = auth.uid() AND revoked_at IS NULL
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = auth.uid() AND revoked_at IS NULL
    )
  );

CREATE POLICY ai_workspace_files_owner_delete ON ai_workspace_files
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM collaborators
       WHERE user_uid = auth.uid() AND revoked_at IS NULL
    )
  );

REVOKE ALL ON ai_workspace_files FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_workspace_files TO authenticated;
REVOKE ALL ON FUNCTION ai_workspace_file_limits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_workspace_files_touch_updated_at() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ai_create_job_with_context(
  p_idempotency_key uuid,
  p_provider text,
  p_input text,
  p_include_business_context boolean,
  p_include_project_context boolean
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
    IF v_job.provider <> p_provider OR v_job.input <> p_input
      OR v_job.include_business_context <> p_include_business_context
      OR v_job.include_project_context <> p_include_project_context THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otros datos';
    END IF;
    RETURN v_job;
  END IF;

  SELECT count(*) INTO v_pending_count FROM ai_jobs
    WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO ai_jobs (user_id, idempotency_key, provider, input, include_business_context, include_project_context)
  VALUES (v_actor, p_idempotency_key, p_provider, p_input, p_include_business_context, p_include_project_context)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION ai_create_job_with_context(uuid, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_create_job_with_context(uuid, text, text, boolean, boolean) TO authenticated;

-- Per-account local AI Bridge pairing. Each RivaStock owner can bind one PC
-- with a revocable capability; the worker capability never grants app access.

BEGIN;

CREATE TABLE ai_bridge_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  state        text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'busy')),
  current_job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_bridge_devices_one_active_per_user_idx
  ON ai_bridge_devices (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE ai_bridge_device_secrets (
  device_id           uuid PRIMARY KEY REFERENCES ai_bridge_devices(id) ON DELETE CASCADE,
  pairing_hash        text,
  pairing_expires_at  timestamptz,
  token_hash          text
);

ALTER TABLE ai_bridge_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_bridge_device_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_bridge_devices_owner_read ON ai_bridge_devices
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM collaborators
      WHERE user_uid = auth.uid() AND revoked_at IS NULL
    )
  );

REVOKE ALL ON ai_bridge_devices, ai_bridge_device_secrets FROM anon, authenticated;
GRANT SELECT (id, user_id, name, state, current_job_id, last_seen_at, revoked_at, created_at)
  ON ai_bridge_devices TO authenticated;

CREATE FUNCTION pair_ai_bridge_device(p_name text DEFAULT 'Mi PC')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_device_id uuid := gen_random_uuid();
  v_code text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_name text := left(btrim(COALESCE(p_name, 'Mi PC')), 80);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM collaborators
    WHERE user_uid = v_user_id AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede vincular una computadora'; END IF;
  IF char_length(v_name) = 0 THEN RAISE EXCEPTION 'Nombre de computadora inválido'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));

  -- A business has one active AI Bridge PC. Pairing a replacement revokes the
  -- previous capability first, while existing job leases expire normally.
  UPDATE ai_bridge_devices
    SET revoked_at = now(), state = 'idle', current_job_id = NULL
    WHERE user_id = v_user_id AND revoked_at IS NULL;
  UPDATE ai_bridge_device_secrets s
    SET pairing_hash = NULL, pairing_expires_at = NULL, token_hash = NULL
    FROM ai_bridge_devices d
    WHERE d.id = s.device_id AND d.user_id = v_user_id AND d.revoked_at IS NOT NULL;

  INSERT INTO ai_bridge_devices (id, user_id, name)
  VALUES (v_device_id, v_user_id, v_name);
  INSERT INTO ai_bridge_device_secrets (device_id, pairing_hash, pairing_expires_at)
  VALUES (
    v_device_id,
    encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
    now() + interval '5 minutes'
  );

  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'name', v_name,
    'pairing_code', v_code,
    'pairing_expires_at', now() + interval '5 minutes'
  );
END;
$$;

CREATE FUNCTION revoke_ai_bridge_device(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR EXISTS (
    SELECT 1 FROM collaborators
    WHERE user_uid = auth.uid() AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede desvincular una computadora'; END IF;

  UPDATE ai_bridge_devices
    SET revoked_at = now(), state = 'idle', current_job_id = NULL
    WHERE id = p_device_id AND user_id = auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Computadora inexistente o ya desvinculada'; END IF;

  UPDATE ai_bridge_device_secrets
    SET pairing_hash = NULL, pairing_expires_at = NULL, token_hash = NULL
    WHERE device_id = p_device_id;
END;
$$;

CREATE FUNCTION ai_bridge_authorize_device(p_device_id uuid, p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_pairing_hash text;
  v_pairing_expires_at timestamptz;
  v_token_hash text;
  v_supplied_hash text;
BEGIN
  IF p_device_id IS NULL OR p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 256 THEN
    RAISE EXCEPTION 'Conexión inválida';
  END IF;
  v_supplied_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  SELECT d.user_id, s.pairing_hash, s.pairing_expires_at, s.token_hash
    INTO v_user_id, v_pairing_hash, v_pairing_expires_at, v_token_hash
    FROM ai_bridge_devices d
    JOIN ai_bridge_device_secrets s ON s.device_id = d.id
    WHERE d.id = p_device_id AND d.revoked_at IS NULL
    FOR UPDATE OF d, s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;

  IF v_pairing_hash = v_supplied_hash AND v_pairing_expires_at > now() THEN
    UPDATE ai_bridge_device_secrets
      SET pairing_hash = NULL, pairing_expires_at = NULL, token_hash = v_supplied_hash
      WHERE device_id = p_device_id;
  ELSIF v_token_hash IS DISTINCT FROM v_supplied_hash THEN
    RAISE EXCEPTION 'Conexión vencida o revocada';
  END IF;

  UPDATE ai_bridge_devices SET last_seen_at = now()
    WHERE id = p_device_id AND revoked_at IS NULL;
  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION pair_ai_bridge_device(text), revoke_ai_bridge_device(uuid), ai_bridge_authorize_device(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pair_ai_bridge_device(text), revoke_ai_bridge_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ai_bridge_authorize_device(uuid, text) TO service_role;

-- Keep the existing queue's lease and ownership rules, while publishing the
-- current worker state against the paired device for per-account status UI.
ALTER FUNCTION ai_bridge_worker(text, uuid, uuid, uuid, jsonb)
  RENAME TO ai_bridge_worker_legacy;
REVOKE ALL ON FUNCTION ai_bridge_worker_legacy(text, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION ai_bridge_worker(
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
  v_response jsonb;
  v_state text;
  v_current_job_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_bridge_devices
    WHERE user_id = p_owner_uid AND revoked_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM ai_bridge_devices
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;

  v_response := ai_bridge_worker_legacy(p_action, p_owner_uid, p_worker_id, p_job_id, p_result);

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

  UPDATE ai_bridge_devices
    SET state = v_state, current_job_id = v_current_job_id, last_seen_at = now()
    WHERE id = p_worker_id AND user_id = p_owner_uid AND revoked_at IS NULL;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION ai_bridge_worker(text, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_bridge_worker(text, uuid, uuid, uuid, jsonb) TO service_role;

COMMIT;

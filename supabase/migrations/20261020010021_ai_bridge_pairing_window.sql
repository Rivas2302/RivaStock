-- Give the account owner enough time to download and launch the local installer.
CREATE OR REPLACE FUNCTION pair_ai_bridge_device(p_name text DEFAULT 'Mi PC')
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
    now() + interval '30 minutes'
  );

  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'name', v_name,
    'pairing_code', v_code,
    'pairing_expires_at', now() + interval '30 minutes'
  );
END;
$$;

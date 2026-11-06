BEGIN;

ALTER TABLE public.facebook_worker_policy
  ADD COLUMN required_extension_version text NOT NULL DEFAULT '0.5.24';

ALTER TABLE public.facebook_worker_policy
  ADD CONSTRAINT facebook_worker_policy_required_extension_version_check
  CHECK (required_extension_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

UPDATE public.facebook_worker_policy
SET required_extension_version = '0.5.24', updated_at = now();

ALTER FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb)
  RENAME TO facebook_worker_v2_before_extension_update;
REVOKE ALL ON FUNCTION public.facebook_worker_v2_before_extension_update(text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.facebook_worker_v2(
  p_token text,
  p_operation text,
  p_delivery uuid DEFAULT NULL,
  p_attempt uuid DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_device_id uuid;
  v_user_id uuid;
  v_required_version text;
  v_reload_safe boolean;
BEGIN
  v_result := public.facebook_worker_v2_before_extension_update(
    p_token, p_operation, p_delivery, p_attempt, p_data
  );

  IF p_operation IS DISTINCT FROM 'heartbeat'
    OR coalesce((v_result->>'connected')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  SELECT device.id, device.user_id
  INTO v_device_id, v_user_id
  FROM public.facebook_devices AS device
  JOIN public.facebook_device_secrets AS secret ON secret.device_id = device.id
  WHERE device.revoked_at IS NULL
    AND secret.token_expires_at > now()
    AND secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT policy.required_extension_version
  INTO v_required_version
  FROM public.facebook_worker_policy AS policy
  WHERE policy.user_id = v_user_id;

  v_required_version := coalesce(v_required_version, '0.5.24');
  v_reload_safe := NOT EXISTS (
    SELECT 1 FROM public.facebook_delivery_attempts AS attempt
    WHERE attempt.device_id = v_device_id AND attempt.finished_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.facebook_deliveries AS delivery
    WHERE delivery.device_id = v_device_id AND delivery.status = 'running'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.fb_rehearsals AS rehearsal
    WHERE rehearsal.device_id = v_device_id AND rehearsal.status = 'running'
  );

  RETURN v_result || jsonb_build_object(
    'required_extension_version', v_required_version,
    'reload_safe', v_reload_safe
  );
END;
$$;

REVOKE ALL ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb)
  TO anon, authenticated;

COMMIT;

BEGIN;

-- One expiry routine for the extension watchdog (scoped to its owner) and for a
-- scheduled job (every owner), so stale work leaves `running` even when no PC
-- and no browser session is open. Each expiry is recorded on the attempt.
CREATE FUNCTION facebook_expire_stale_deliveries(p_owner uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_job     facebook_deliveries;
  v_attempt facebook_delivery_attempts;
  v_count   integer := 0;
  v_now     timestamptz := clock_timestamp();
BEGIN
  FOR v_job IN
    SELECT d.* FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE (p_owner IS NULL OR p.user_id=p_owner) AND d.status='running'
    ORDER BY d.id FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF v_job.active_attempt_id IS NULL THEN
      IF v_job.claimed_at < v_now - interval '5 minutes' THEN
        UPDATE facebook_deliveries
        SET status='attention', message='Ejecución interrumpida; revisá el resultado.', updated_at=v_now
        WHERE id=v_job.id;
        v_count := v_count + 1;
      END IF;
      CONTINUE;
    END IF;
    SELECT * INTO v_attempt FROM facebook_delivery_attempts WHERE id=v_job.active_attempt_id FOR UPDATE;
    IF (v_attempt.authorized_at IS NULL AND v_attempt.lease_expires_at < v_now)
      OR v_attempt.authorized_at < v_now - interval '2 minutes' THEN
      UPDATE facebook_delivery_attempts
      SET finished_at=v_now,
          outcome=CASE WHEN authorized_at IS NULL THEN 'interrupted' ELSE 'unknown' END,
          last_error_code=CASE WHEN authorized_at IS NULL THEN 'PREPARATION_INTERRUPTED' ELSE 'RESULT_UNKNOWN' END
      WHERE id=v_attempt.id;
      PERFORM facebook_attempt_event(v_attempt.id,'attention',
        jsonb_build_object('message','Ejecución interrumpida; revisá el resultado.','source','watchdog'),
        'watchdog-'||v_attempt.id::text);
      UPDATE facebook_deliveries
      SET status='attention', active_attempt_id=NULL,
          message='Ejecución interrumpida; revisá el resultado.', updated_at=v_now
      WHERE id=v_job.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION facebook_expire_stale_deliveries(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION facebook_watchdog(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_owner uuid;
BEGIN
  SELECT d.* INTO v_device
  FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
  WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    AND d.revoked_at IS NULL AND s.token_expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'TOKEN_EXPIRED'; END IF;
  v_owner:=get_owner_uid(v_device.user_id);
  -- NULL means every owner; a device token must never reach that scope.
  IF v_owner IS NULL THEN RAISE EXCEPTION 'TOKEN_EXPIRED'; END IF;
  RETURN jsonb_build_object('expired_attempts', facebook_expire_stale_deliveries(v_owner));
END; $$;
REVOKE ALL ON FUNCTION facebook_watchdog(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_watchdog(text) TO anon;

-- The web refresh uses the same routine, so every expiry leaves the same audit trail.
CREATE OR REPLACE FUNCTION refresh_facebook_delivery_states() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'stock','read') THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 v_owner:=get_owner_uid(auth.uid());
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin permiso'; END IF;
 RETURN jsonb_build_object('expired_attempts', facebook_expire_stale_deliveries(v_owner));
END; $$;
REVOKE ALL ON FUNCTION refresh_facebook_delivery_states() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION refresh_facebook_delivery_states() TO authenticated;

-- Scheduled entry point: no client may call it.
CREATE FUNCTION facebook_cron_watchdog() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('expired_attempts', facebook_expire_stale_deliveries(NULL));
$$;
REVOKE ALL ON FUNCTION facebook_cron_watchdog() FROM PUBLIC,anon,authenticated;

-- Schedules itself only where pg_cron is enabled; elsewhere this is a no-op.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('facebook-watchdog','*/2 * * * *','SELECT public.facebook_cron_watchdog()');
  END IF;
END; $$;

COMMIT;

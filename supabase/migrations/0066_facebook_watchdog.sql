BEGIN;

-- B3: Extension-callable watchdog for stuck delivery expiry.
-- The Chrome extension calls facebook_watchdog() on every alarm tick (~30 s).
-- This covers the case where the web is not open; two devices expire only their
-- own tenant's deliveries, so concurrent watchdog calls are safe (SKIP LOCKED).
--
-- pg_cron alternative (requires pg_cron enabled in Supabase → Extensions):
--   SELECT cron.schedule('facebook-watchdog-cron', '*/3 * * * *',
--     $$SELECT facebook_cron_watchdog()$$);
-- Then apply the companion function below by removing the block comment delimiters.

CREATE FUNCTION facebook_watchdog(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_device  facebook_devices;
  v_job     facebook_deliveries;
  v_attempt facebook_delivery_attempts;
  v_count   integer := 0;
  v_now     timestamptz := clock_timestamp();
BEGIN
  SELECT d.* INTO v_device
  FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
  WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    AND d.revoked_at IS NULL AND s.token_expires_at>v_now;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOKEN_EXPIRED'; END IF;

  FOR v_job IN
    SELECT d.* FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=get_owner_uid(v_device.user_id) AND d.status='running'
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
          outcome=CASE WHEN authorized_at IS NULL THEN 'interrupted' ELSE 'unknown' END
      WHERE id=v_attempt.id;
      UPDATE facebook_deliveries
      SET status='attention', active_attempt_id=NULL,
          message='Ejecución interrumpida; revisá el resultado.', updated_at=v_now
      WHERE id=v_job.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('expired_attempts', v_count);
END; $$;
REVOKE ALL ON FUNCTION facebook_watchdog(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_watchdog(text) TO anon;

/* pg_cron companion — uncomment after enabling pg_cron extension:

CREATE FUNCTION facebook_cron_watchdog()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_job     facebook_deliveries;
  v_attempt facebook_delivery_attempts;
  v_now     timestamptz := clock_timestamp();
BEGIN
  FOR v_job IN
    SELECT d.* FROM facebook_deliveries d WHERE d.status='running'
    ORDER BY d.id FOR UPDATE OF d SKIP LOCKED
  LOOP
    IF v_job.active_attempt_id IS NULL THEN
      IF v_job.claimed_at < v_now - interval '5 minutes' THEN
        UPDATE facebook_deliveries
        SET status='attention', message='Ejecución interrumpida; revisá el resultado.', updated_at=v_now
        WHERE id=v_job.id;
      END IF;
      CONTINUE;
    END IF;
    SELECT * INTO v_attempt FROM facebook_delivery_attempts WHERE id=v_job.active_attempt_id FOR UPDATE;
    IF (v_attempt.authorized_at IS NULL AND v_attempt.lease_expires_at < v_now)
      OR v_attempt.authorized_at < v_now - interval '2 minutes' THEN
      UPDATE facebook_delivery_attempts
      SET finished_at=v_now,
          outcome=CASE WHEN authorized_at IS NULL THEN 'interrupted' ELSE 'unknown' END
      WHERE id=v_attempt.id;
      UPDATE facebook_deliveries
      SET status='attention', active_attempt_id=NULL,
          message='Ejecución interrumpida; revisá el resultado.', updated_at=v_now
      WHERE id=v_job.id;
    END IF;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION facebook_cron_watchdog() FROM PUBLIC,anon,authenticated;

*/

COMMIT;

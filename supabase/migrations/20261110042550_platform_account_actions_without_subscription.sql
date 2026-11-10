BEGIN;

CREATE OR REPLACE FUNCTION public.platform_request_business_deletion(
  p_owner_uid uuid,
  p_confirmed_business_name text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_email text;
  v_confirmation_target text;
  v_plan_code text;
  v_status text;
  v_scheduled_for timestamptz := now() + interval '30 days';
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF auth.uid() = p_owner_uid THEN RAISE EXCEPTION 'platform-business-protected'; END IF;

  SELECT profile.business_name, account.email
    INTO v_name, v_email
    FROM public.profiles profile
    LEFT JOIN auth.users account ON account.id = profile.id
    WHERE profile.id = p_owner_uid;
  IF NOT FOUND OR v_email IS NULL THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  v_confirmation_target := COALESCE(NULLIF(btrim(v_name), ''), NULLIF(btrim(v_email), ''));

  SELECT plan_code, status INTO v_plan_code, v_status
    FROM public.business_subscriptions WHERE owner_uid = p_owner_uid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (
      SELECT 1 FROM public.collaborators
      WHERE user_uid = p_owner_uid AND owner_uid = auth.uid()
    )
    OR v_plan_code = 'interno' THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF v_confirmation_target IS NULL
    OR lower(btrim(COALESCE(p_confirmed_business_name, ''))) IS DISTINCT FROM lower(v_confirmation_target) THEN
    RAISE EXCEPTION 'platform-business-name-confirmation-mismatch';
  END IF;
  v_status := COALESCE(v_status, 'active');
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;

  INSERT INTO public.business_deletion_requests(owner_uid, requested_by, scheduled_for, previous_status)
    VALUES (p_owner_uid, auth.uid(), v_scheduled_for, v_status)
    ON CONFLICT (owner_uid) DO UPDATE SET
      requested_by = EXCLUDED.requested_by,
      requested_at = now(),
      scheduled_for = EXCLUDED.scheduled_for,
      previous_status = EXCLUDED.previous_status,
      cancelled_at = NULL,
      purge_started_at = NULL,
      purge_attempts = 0,
      last_failure_code = NULL
    WHERE business_deletion_requests.cancelled_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-deletion-already-pending'; END IF;

  UPDATE public.business_subscriptions SET status = 'suspended', updated_at = now()
    WHERE owner_uid = p_owner_uid;
  RETURN v_scheduled_for;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_request_business_deletion_now(
  p_owner_uid uuid,
  p_confirmed_business_name text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_email text;
  v_confirmation_target text;
  v_plan_code text;
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF auth.uid() = p_owner_uid THEN RAISE EXCEPTION 'platform-business-protected'; END IF;

  SELECT profile.business_name, account.email
    INTO v_name, v_email
    FROM public.profiles profile
    LEFT JOIN auth.users account ON account.id = profile.id
    WHERE profile.id = p_owner_uid;
  IF NOT FOUND OR v_email IS NULL THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  v_confirmation_target := COALESCE(NULLIF(btrim(v_name), ''), NULLIF(btrim(v_email), ''));

  SELECT plan_code, status INTO v_plan_code, v_status
    FROM public.business_subscriptions WHERE owner_uid = p_owner_uid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (
      SELECT 1 FROM public.collaborators
      WHERE user_uid = p_owner_uid AND owner_uid = auth.uid()
    )
    OR v_plan_code = 'interno' THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF v_confirmation_target IS NULL
    OR lower(btrim(COALESCE(p_confirmed_business_name, ''))) IS DISTINCT FROM lower(v_confirmation_target) THEN
    RAISE EXCEPTION 'platform-business-name-confirmation-mismatch';
  END IF;
  v_status := COALESCE(v_status, 'active');
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;

  INSERT INTO public.business_deletion_requests(
    owner_uid, requested_by, requested_at, scheduled_for, previous_status,
    cancelled_at, purge_started_at, purge_attempts, last_failure_code
  ) VALUES (
    p_owner_uid, auth.uid(), v_now - interval '1 second', v_now, v_status,
    NULL, v_now, 1, NULL
  )
  ON CONFLICT (owner_uid) DO UPDATE SET
    requested_by = EXCLUDED.requested_by,
    requested_at = EXCLUDED.requested_at,
    scheduled_for = EXCLUDED.scheduled_for,
    previous_status = EXCLUDED.previous_status,
    cancelled_at = NULL,
    purge_started_at = EXCLUDED.purge_started_at,
    purge_attempts = EXCLUDED.purge_attempts,
    last_failure_code = NULL
  WHERE business_deletion_requests.cancelled_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-deletion-already-pending'; END IF;

  UPDATE public.business_subscriptions SET status = 'suspended' WHERE owner_uid = p_owner_uid;
  RETURN v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_schedule_business_suspension(
  p_owner_uid uuid,
  p_scheduled_for timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_plan text;
  v_existing timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF auth.uid() = p_owner_uid OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = p_owner_uid AND owner_uid = auth.uid()) THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  SELECT status, plan_code, suspension_scheduled_for INTO v_status, v_plan, v_existing
    FROM public.business_subscriptions WHERE owner_uid = p_owner_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-not-found'; END IF;
  IF v_plan = 'interno' THEN RAISE EXCEPTION 'platform-business-protected'; END IF;
  IF v_status = 'suspended' THEN RAISE EXCEPTION 'platform-business-already-suspended'; END IF;
  IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'platform-business-suspension-already-scheduled'; END IF;
  IF p_scheduled_for IS NULL OR p_scheduled_for < now() + interval '1 minute' OR p_scheduled_for > now() + interval '90 days' THEN
    RAISE EXCEPTION 'platform-business-suspension-date-invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;

  UPDATE public.business_subscriptions
    SET suspension_previous_status = status,
        suspension_scheduled_for = p_scheduled_for,
        suspension_notice_sent_at = NULL,
        suspension_notice_error = NULL,
        updated_at = now()
    WHERE owner_uid = p_owner_uid;
  RETURN p_scheduled_for;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_cancel_business_suspension(p_owner_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF p_owner_uid = auth.uid() OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (SELECT 1 FROM public.business_subscriptions WHERE owner_uid = p_owner_uid AND plan_code = 'interno')
    OR EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = p_owner_uid AND owner_uid = auth.uid()) THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;
  UPDATE public.business_subscriptions
    SET suspension_scheduled_for = NULL, suspension_previous_status = NULL,
        suspension_notice_sent_at = NULL, suspension_notice_error = NULL, updated_at = now()
    WHERE owner_uid = p_owner_uid AND status <> 'suspended' AND suspension_scheduled_for > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-suspension-not-pending'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_reactivate_business(p_owner_uid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'platform-admin-required'; END IF;
  IF p_owner_uid = auth.uid() OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_owner_uid)
    OR EXISTS (SELECT 1 FROM public.business_subscriptions WHERE owner_uid = p_owner_uid AND plan_code = 'interno')
    OR EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = p_owner_uid AND owner_uid = auth.uid()) THEN
    RAISE EXCEPTION 'platform-business-protected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_deletion_requests WHERE owner_uid = p_owner_uid AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'platform-business-deletion-already-pending';
  END IF;
  UPDATE public.business_subscriptions
    SET status = COALESCE(suspension_previous_status, 'active'),
        suspension_scheduled_for = NULL, suspension_previous_status = NULL,
        suspension_notice_sent_at = NULL, suspension_notice_error = NULL, updated_at = now()
    WHERE owner_uid = p_owner_uid AND (status = 'suspended' OR suspension_scheduled_for IS NOT NULL)
    RETURNING status INTO v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'platform-business-suspension-not-pending'; END IF;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_request_business_deletion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_request_business_deletion(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_request_business_deletion_now(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_request_business_deletion_now(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_schedule_business_suspension(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_cancel_business_suspension(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_reactivate_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_schedule_business_suspension(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_cancel_business_suspension(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_reactivate_business(uuid) TO authenticated;

COMMIT;

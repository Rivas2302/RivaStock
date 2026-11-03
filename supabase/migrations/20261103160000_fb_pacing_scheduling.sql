BEGIN;

CREATE TABLE public.fb_pacing_policy (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  min_gap_seconds integer NOT NULL DEFAULT 720 CHECK (min_gap_seconds BETWEEN 60 AND 86400),
  jitter_pct integer NOT NULL DEFAULT 30 CHECK (jitter_pct BETWEEN 0 AND 100),
  daily_marketplace_cap integer NOT NULL DEFAULT 5 CHECK (daily_marketplace_cap BETWEEN 1 AND 100),
  daily_group_cap integer NOT NULL DEFAULT 15 CHECK (daily_group_cap BETWEEN 1 AND 500),
  max_groups_per_listing integer NOT NULL DEFAULT 10 CHECK (max_groups_per_listing BETWEEN 1 AND 20),
  repeat_group_days integer NOT NULL DEFAULT 14 CHECK (repeat_group_days BETWEEN 1 AND 365),
  quiet_hours_start time NOT NULL DEFAULT '23:00',
  quiet_hours_end time NOT NULL DEFAULT '08:00',
  timezone_name text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'
    CHECK (timezone_name IN ('America/Argentina/Buenos_Aires','America/Santiago','America/Sao_Paulo','UTC')),
  warmup_until date NOT NULL DEFAULT (current_date + 14),
  pause_on_warning_hours integer NOT NULL DEFAULT 48 CHECK (pause_on_warning_hours BETWEEN 1 AND 168),
  next_allowed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.fb_pacing_set_signup_warmup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created_at timestamptz;
BEGIN
  SELECT profile.created_at INTO v_created_at
  FROM public.profiles AS profile WHERE profile.id = NEW.user_id;
  IF v_created_at IS NOT NULL THEN
    NEW.warmup_until := v_created_at::date + 14;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_set_signup_warmup() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER fb_pacing_policy_signup_warmup
  BEFORE INSERT ON public.fb_pacing_policy
  FOR EACH ROW EXECUTE FUNCTION public.fb_pacing_set_signup_warmup();

ALTER TABLE public.fb_pacing_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fb_pacing_policy FROM PUBLIC, anon, authenticated;

CREATE TABLE public.fb_pacing_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trace_id uuid NOT NULL REFERENCES public.fb_run_traces(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.fb_trace_steps(id) ON DELETE CASCADE,
  warning_text text NOT NULL CHECK (char_length(warning_text) BETWEEN 1 AND 500),
  source text NOT NULL DEFAULT 'trace_text' CHECK (source IN ('trace_text','supervisor_vision')),
  category text NOT NULL DEFAULT 'text_warning'
    CHECK (category IN ('text_warning','checkpoint','rate_limit','restriction','unusual_activity','uncertain')),
  confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE(step_id)
);

ALTER TABLE public.fb_pacing_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY fb_pacing_alerts_owner_read ON public.fb_pacing_alerts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND user_id = (SELECT public.knowledge_owner_for('read')));
REVOKE ALL ON public.fb_pacing_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fb_pacing_alerts TO authenticated;
CREATE INDEX fb_pacing_alerts_unresolved_idx
  ON public.fb_pacing_alerts(user_id, created_at DESC) WHERE acknowledged_at IS NULL;

ALTER TABLE public.facebook_deliveries
  ADD COLUMN scheduled_at timestamptz,
  DROP CONSTRAINT facebook_deliveries_status_check,
  ADD CONSTRAINT facebook_deliveries_status_check
    CHECK (status IN ('pending','scheduled','running','submitted','published','pending_approval','attention','cancelled'));
CREATE INDEX facebook_deliveries_scheduled_idx
  ON public.facebook_deliveries(scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.facebook_devices
  ADD COLUMN queue_pause_reason text CHECK (queue_pause_reason IS NULL OR queue_pause_reason = 'facebook_warning'),
  ADD COLUMN queue_pause_until timestamptz;

CREATE FUNCTION public.fb_clear_warning_pause_on_resume()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.queue_enabled IS DISTINCT FROM NEW.queue_enabled AND NEW.queue_enabled THEN
    NEW.queue_pause_reason := NULL;
    NEW.queue_pause_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_clear_warning_pause_on_resume() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER facebook_devices_clear_warning_pause
  BEFORE UPDATE OF queue_enabled ON public.facebook_devices
  FOR EACH ROW EXECUTE FUNCTION public.fb_clear_warning_pause_on_resume();

CREATE OR REPLACE FUNCTION public.set_facebook_queue_enabled(p_device uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.facebook_devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> public.get_owner_uid(auth.uid())
    OR NOT public.has_permission(auth.uid(), 'config', 'write') OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Solo el titular puede gestionar la conexión';
  END IF;
  SELECT * INTO v_device FROM public.facebook_devices
  WHERE id = p_device AND user_id = auth.uid() AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Computadora inexistente o revocada'; END IF;
  IF p_enabled AND v_device.queue_pause_reason = 'facebook_warning'
    AND v_device.queue_pause_until > now() THEN
    RAISE EXCEPTION 'FACEBOOK_WARNING_PAUSE_ACTIVE';
  END IF;
  UPDATE public.facebook_devices
  SET queue_enabled = p_enabled, queue_command_at = clock_timestamp()
  WHERE id = p_device;
END;
$$;
REVOKE ALL ON FUNCTION public.set_facebook_queue_enabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_facebook_queue_enabled(uuid, boolean) TO authenticated;

CREATE FUNCTION public.fb_schedule_delivery_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_schedule_text text;
  v_schedule timestamptz;
  v_publication_user uuid;
BEGIN
  SELECT publication.user_id, publication.content->>'schedule_at'
  INTO v_publication_user, v_schedule_text
  FROM public.facebook_publications AS publication
  WHERE publication.id = NEW.publication_id;

  IF v_publication_user IS NULL OR v_schedule_text IS NULL OR v_schedule_text = '' THEN
    NEW.scheduled_at := NULL;
    RETURN NEW;
  END IF;

  BEGIN
    v_schedule := v_schedule_text::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'La fecha programada no es válida';
  END;

  IF v_schedule > now() + interval '90 days' THEN
    RAISE EXCEPTION 'La publicación no se puede programar a más de 90 días';
  END IF;

  IF NEW.status <> 'pending' THEN
    NEW.scheduled_at := NULL;
    RETURN NEW;
  END IF;
  IF v_schedule > now() THEN
    NEW.scheduled_at := v_schedule;
    NEW.status := 'scheduled';
  ELSE
    NEW.scheduled_at := NULL;
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_schedule_delivery_before_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER facebook_delivery_schedule_before_insert
  BEFORE INSERT ON public.facebook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.fb_schedule_delivery_before_insert();

CREATE FUNCTION public.fb_pacing_policy_get()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_policy public.fb_pacing_policy%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Solo el dueño puede administrar el ritmo de publicación';
  END IF;

  INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_owner) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_owner;
  RETURN to_jsonb(v_policy) - 'user_id' - 'created_at';
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_policy_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_pacing_policy_get() TO authenticated;

CREATE FUNCTION public.fb_pacing_policy_update(p_policy jsonb, p_confirm_risk boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_existing public.fb_pacing_policy%ROWTYPE;
  v_min_gap integer;
  v_jitter integer;
  v_marketplace integer;
  v_groups integer;
  v_max_groups integer;
  v_repeat_days integer;
  v_quiet_start time;
  v_quiet_end time;
  v_timezone text;
  v_warning_hours integer;
  v_existing_quiet_minutes integer;
  v_new_quiet_minutes integer;
  v_is_risk boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar el ritmo de publicación';
  END IF;
  IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'La configuración de ritmo no es válida';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_policy) AS k(key) WHERE k.key NOT IN (
      'min_gap_seconds','jitter_pct','daily_marketplace_cap','daily_group_cap','max_groups_per_listing',
      'repeat_group_days','quiet_hours_start','quiet_hours_end','timezone_name','pause_on_warning_hours'
    )) THEN
    RAISE EXCEPTION 'La configuración de ritmo no es válida';
  END IF;

  INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_owner) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_existing FROM public.fb_pacing_policy WHERE user_id = v_owner FOR UPDATE;
  v_min_gap := coalesce((p_policy->>'min_gap_seconds')::integer, v_existing.min_gap_seconds);
  v_jitter := coalesce((p_policy->>'jitter_pct')::integer, v_existing.jitter_pct);
  v_marketplace := coalesce((p_policy->>'daily_marketplace_cap')::integer, v_existing.daily_marketplace_cap);
  v_groups := coalesce((p_policy->>'daily_group_cap')::integer, v_existing.daily_group_cap);
  v_max_groups := coalesce((p_policy->>'max_groups_per_listing')::integer, v_existing.max_groups_per_listing);
  v_repeat_days := coalesce((p_policy->>'repeat_group_days')::integer, v_existing.repeat_group_days);
  v_quiet_start := coalesce((p_policy->>'quiet_hours_start')::time, v_existing.quiet_hours_start);
  v_quiet_end := coalesce((p_policy->>'quiet_hours_end')::time, v_existing.quiet_hours_end);
  v_timezone := coalesce(p_policy->>'timezone_name', v_existing.timezone_name);
  v_warning_hours := coalesce((p_policy->>'pause_on_warning_hours')::integer, v_existing.pause_on_warning_hours);
  v_existing_quiet_minutes := CASE
    WHEN v_existing.quiet_hours_start = v_existing.quiet_hours_end THEN 0
    WHEN v_existing.quiet_hours_start < v_existing.quiet_hours_end
      THEN extract(epoch FROM (v_existing.quiet_hours_end - v_existing.quiet_hours_start))::integer / 60
    ELSE (86400 + extract(epoch FROM (v_existing.quiet_hours_end - v_existing.quiet_hours_start))::integer) / 60
  END;
  v_new_quiet_minutes := CASE
    WHEN v_quiet_start = v_quiet_end THEN 0
    WHEN v_quiet_start < v_quiet_end
      THEN extract(epoch FROM (v_quiet_end - v_quiet_start))::integer / 60
    ELSE (86400 + extract(epoch FROM (v_quiet_end - v_quiet_start))::integer) / 60
  END;
  v_is_risk := v_min_gap < 720 OR v_jitter > 30 OR v_marketplace > 5 OR v_groups > 15
    OR v_max_groups > 10 OR v_repeat_days < 14 OR v_warning_hours < 48
    OR v_new_quiet_minutes < 540 OR v_new_quiet_minutes < v_existing_quiet_minutes
    OR v_timezone <> v_existing.timezone_name;
  IF v_is_risk AND NOT coalesce(p_confirm_risk, false) THEN
    RAISE EXCEPTION 'RISK_CONFIRMATION_REQUIRED';
  END IF;

  UPDATE public.fb_pacing_policy SET
    min_gap_seconds = v_min_gap,
    jitter_pct = v_jitter,
    daily_marketplace_cap = v_marketplace,
    daily_group_cap = v_groups,
    max_groups_per_listing = v_max_groups,
    repeat_group_days = v_repeat_days,
    quiet_hours_start = v_quiet_start,
    quiet_hours_end = v_quiet_end,
    timezone_name = v_timezone,
    pause_on_warning_hours = v_warning_hours,
    updated_at = now()
  WHERE user_id = v_owner;
  RETURN public.fb_pacing_policy_get();
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_policy_update(jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_pacing_policy_update(jsonb, boolean) TO authenticated;

CREATE FUNCTION public.fb_pacing_alert_acknowledge(p_alert uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Solo el dueño puede cerrar el aviso';
  END IF;
  UPDATE public.fb_pacing_alerts
  SET acknowledged_at = coalesce(acknowledged_at, now())
  WHERE id = p_alert AND user_id = v_owner;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_alert_acknowledge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_pacing_alert_acknowledge(uuid) TO authenticated;

ALTER FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
  RENAME TO approve_facebook_publication_v2_before_pacing;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2_before_pacing(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid,
  p_intent uuid,
  p_content jsonb,
  p_groups uuid[],
  p_marketplace boolean,
  p_mode text,
  p_repeat_of uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_policy public.fb_pacing_policy%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = v_owner AND p_groups IS NOT NULL AND cardinality(p_groups) > 0 THEN
    INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_owner) ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_owner;
    IF cardinality(p_groups) > v_policy.max_groups_per_listing THEN
      RAISE EXCEPTION 'La política permite hasta % grupos por publicación', v_policy.max_groups_per_listing;
    END IF;
  END IF;
  RETURN public.approve_facebook_publication_v2_before_pacing(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, p_repeat_of
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
  TO authenticated;

CREATE FUNCTION public.fb_pacing_detect_warning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trace public.fb_run_traces%ROWTYPE;
  v_policy public.fb_pacing_policy%ROWTYPE;
  v_text text;
BEGIN
  SELECT * INTO v_trace FROM public.fb_run_traces WHERE id = NEW.trace_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_text := left(concat_ws(' ', NEW.note, NEW.dom_summary->>'alerts', NEW.dom_summary->>'reason'), 5000);
  IF v_text !~* '(checkpoint|captcha|unusual activity|actividad inusual|cuenta restringida|account restricted|action blocked|bloque[oó]|l[ií]mite alcanzado|limit reached|verificaci[oó]n de seguridad|security check|restringid[oa])' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_trace.user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_trace.user_id;
  INSERT INTO public.fb_pacing_alerts(user_id, trace_id, step_id, warning_text)
  VALUES (v_trace.user_id, NEW.trace_id, NEW.id, left(v_text, 500))
  ON CONFLICT (step_id) DO NOTHING;
  UPDATE public.facebook_devices
  SET queue_enabled = false, queue_command_at = now(), execution_state = 'paused',
    queue_pause_reason = 'facebook_warning',
    queue_pause_until = now() + make_interval(hours => v_policy.pause_on_warning_hours)
  WHERE user_id = v_trace.user_id AND revoked_at IS NULL
    AND (queue_enabled OR queue_pause_reason = 'facebook_warning');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_detect_warning() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER fb_trace_steps_detect_warning
  AFTER INSERT ON public.fb_trace_steps
  FOR EACH ROW EXECUTE FUNCTION public.fb_pacing_detect_warning();

ALTER TABLE public.fb_supervision_requests
  DROP CONSTRAINT fb_supervision_requests_kind_check,
  ADD CONSTRAINT fb_supervision_requests_kind_check
    CHECK (kind IN ('recover_step','verify_result','review_content','review_photos','classify_warning'));
CREATE UNIQUE INDEX fb_supervision_warning_step_unique
  ON public.fb_supervision_requests(trace_id, step_seq) WHERE kind = 'classify_warning';

CREATE FUNCTION public.fb_pacing_request_warning_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trace public.fb_run_traces%ROWTYPE;
  v_policy public.fb_pacing_policy%ROWTYPE;
  v_pending integer;
  v_dom_summary jsonb;
BEGIN
  IF NEW.screenshot_path IS NULL OR NEW.status NOT IN ('failed','retry')
    OR EXISTS (SELECT 1 FROM public.fb_pacing_alerts WHERE step_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_trace FROM public.fb_run_traces WHERE id = NEW.trace_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_trace.user_id::text, 0));
  SELECT count(*)::integer INTO v_pending FROM public.fb_supervision_requests
  WHERE user_id = v_trace.user_id AND status IN ('pending','processing');
  IF v_pending >= 10 THEN
    INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_trace.user_id) ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_trace.user_id;
    INSERT INTO public.fb_pacing_alerts(user_id, trace_id, step_id, warning_text, source, category)
    VALUES (v_trace.user_id, NEW.trace_id, NEW.id,
      'La captura no se pudo clasificar por el límite de supervisión. Revisá Facebook antes de reactivar la cola.',
      'supervisor_vision', 'uncertain')
    ON CONFLICT (step_id) DO NOTHING;
    UPDATE public.facebook_devices
    SET queue_enabled = false, queue_command_at = now(), execution_state = 'paused',
      queue_pause_reason = 'facebook_warning',
      queue_pause_until = now() + make_interval(hours => v_policy.pause_on_warning_hours)
    WHERE user_id = v_trace.user_id AND revoked_at IS NULL
      AND (queue_enabled OR queue_pause_reason = 'facebook_warning');
    RETURN NEW;
  END IF;

  v_dom_summary := jsonb_build_object(
    'scope', CASE WHEN NEW.dom_summary->>'scope' IN ('dialog','form','page') THEN NEW.dom_summary->>'scope' ELSE 'page' END,
    'controls', CASE WHEN jsonb_typeof(NEW.dom_summary->'controls') = 'array' THEN NEW.dom_summary->'controls' ELSE '[]'::jsonb END,
    'headings', CASE WHEN jsonb_typeof(NEW.dom_summary->'headings') = 'array' THEN NEW.dom_summary->'headings' ELSE '[]'::jsonb END,
    'alerts', CASE WHEN jsonb_typeof(NEW.dom_summary->'alerts') = 'array' THEN NEW.dom_summary->'alerts' ELSE '[]'::jsonb END
  );
  IF jsonb_array_length(v_dom_summary->'controls') > 80 OR octet_length(v_dom_summary::text) > 20480 THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.fb_supervision_requests(user_id, trace_id, step_seq, kind, intent, dom_summary, screenshot_path)
  VALUES (v_trace.user_id, NEW.trace_id, NEW.seq, 'classify_warning',
    jsonb_build_object('step','classify_warning','intent_key','warning:'||NEW.trace_id::text||':'||NEW.seq::text,'supervisor_kind','classify_warning'),
    v_dom_summary, NEW.screenshot_path)
  ON CONFLICT (trace_id, step_seq) WHERE kind = 'classify_warning' DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_request_warning_classification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER fb_trace_steps_request_warning_classification
  AFTER INSERT ON public.fb_trace_steps
  FOR EACH ROW EXECUTE FUNCTION public.fb_pacing_request_warning_classification();

CREATE FUNCTION public.fb_pacing_classification_valid(p_decision jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_warning boolean;
  v_confidence numeric;
BEGIN
  IF jsonb_typeof(p_decision) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF octet_length(p_decision::text) > 4096
    OR (SELECT count(*) FROM jsonb_object_keys(p_decision)) <> 4
    OR NOT (p_decision ?& ARRAY['warning','category','observation','confidence'])
    OR jsonb_typeof(p_decision->'warning') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_decision->'category') IS DISTINCT FROM 'string'
    OR p_decision->>'category' NOT IN ('none','checkpoint','rate_limit','restriction','unusual_activity','uncertain')
    OR jsonb_typeof(p_decision->'observation') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_decision->>'observation')) NOT BETWEEN 1 AND 300
    OR jsonb_typeof(p_decision->'confidence') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;
  v_warning := (p_decision->>'warning')::boolean;
  v_confidence := (p_decision->>'confidence')::numeric;
  RETURN v_confidence BETWEEN 0 AND 1
    AND ((v_warning AND p_decision->>'category' <> 'none') OR (NOT v_warning AND p_decision->>'category' = 'none'));
END;
$$;

CREATE OR REPLACE FUNCTION public.fb_supervision_decision_valid(p_decision jsonb, p_dom_summary jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_dom_summary->'intent'->>'supervisor_kind' = 'classify_warning' THEN
    RETURN public.fb_pacing_classification_valid(p_decision);
  END IF;
  IF p_dom_summary->'intent'->>'supervisor_kind' = 'verify_result' THEN
    RETURN public.fb_supervised_result_valid(p_decision, p_dom_summary);
  END IF;
  RETURN public.fb_supervision_menu_decision_valid(p_decision, p_dom_summary);
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_classification_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_supervision_decision_valid(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fb_pacing_apply_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step public.fb_trace_steps%ROWTYPE;
  v_policy public.fb_pacing_policy%ROWTYPE;
BEGIN
  IF NEW.kind <> 'classify_warning' OR NEW.status <> 'answered'
    OR NEW.decision->>'warning' IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;
  SELECT * INTO v_step FROM public.fb_trace_steps
  WHERE trace_id = NEW.trace_id AND seq = NEW.step_seq;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO public.fb_pacing_policy(user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = NEW.user_id;
  INSERT INTO public.fb_pacing_alerts(user_id, trace_id, step_id, warning_text, source, category, confidence)
  VALUES (NEW.user_id, NEW.trace_id, v_step.id, NEW.decision->>'observation', 'supervisor_vision',
    NEW.decision->>'category', (NEW.decision->>'confidence')::numeric)
  ON CONFLICT (step_id) DO NOTHING;
  UPDATE public.facebook_devices
  SET queue_enabled = false, queue_command_at = now(), execution_state = 'paused',
    queue_pause_reason = 'facebook_warning',
    queue_pause_until = now() + make_interval(hours => v_policy.pause_on_warning_hours)
  WHERE user_id = NEW.user_id AND revoked_at IS NULL
    AND (queue_enabled OR queue_pause_reason = 'facebook_warning');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_apply_classification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER fb_supervision_apply_warning_classification
  AFTER UPDATE OF status, decision ON public.fb_supervision_requests
  FOR EACH ROW EXECUTE FUNCTION public.fb_pacing_apply_classification();

CREATE FUNCTION public.fb_pacing_pause_unclassified_warning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step public.fb_trace_steps%ROWTYPE;
  v_policy public.fb_pacing_policy%ROWTYPE;
BEGIN
  IF NEW.kind <> 'classify_warning' OR NEW.status NOT IN ('failed','expired') THEN RETURN NEW; END IF;
  SELECT * INTO v_step FROM public.fb_trace_steps
  WHERE trace_id = NEW.trace_id AND seq = NEW.step_seq;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO public.fb_pacing_policy(user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = NEW.user_id;
  INSERT INTO public.fb_pacing_alerts(user_id, trace_id, step_id, warning_text, source, category)
  VALUES (NEW.user_id, NEW.trace_id, v_step.id,
    'La captura no se pudo clasificar. Revisá Facebook antes de reactivar la cola.',
    'supervisor_vision', 'uncertain')
  ON CONFLICT (step_id) DO NOTHING;
  UPDATE public.facebook_devices
  SET queue_enabled = false, queue_command_at = now(), execution_state = 'paused',
    queue_pause_reason = 'facebook_warning',
    queue_pause_until = now() + make_interval(hours => v_policy.pause_on_warning_hours)
  WHERE user_id = NEW.user_id AND revoked_at IS NULL
    AND (queue_enabled OR queue_pause_reason = 'facebook_warning');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pacing_pause_unclassified_warning() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER fb_supervision_pause_unclassified_warning
  AFTER UPDATE OF status ON public.fb_supervision_requests
  FOR EACH ROW EXECUTE FUNCTION public.fb_pacing_pause_unclassified_warning();

CREATE OR REPLACE FUNCTION public.cancel_facebook_delivery(p_delivery uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.facebook_deliveries%ROWTYPE;
BEGIN
  SELECT delivery.* INTO v_job
  FROM public.facebook_deliveries AS delivery
  JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
  WHERE delivery.id = p_delivery
    AND publication.user_id = public.get_owner_uid(auth.uid())
    AND public.facebook_product_allowed(auth.uid(), publication.product_id, true)
  FOR UPDATE OF delivery;
  IF NOT FOUND OR NOT (v_job.status IN ('pending','scheduled')
    OR (v_job.status = 'attention' AND v_job.submitted_at IS NULL AND NOT v_job.recovery_required)) THEN
    RAISE EXCEPTION 'El envío ya comenzó o no tenés permiso';
  END IF;
  IF v_job.status = 'attention' THEN
    UPDATE public.facebook_delivery_attempts
    SET finished_at = coalesce(finished_at, now()), outcome = coalesce(outcome, 'interrupted')
    WHERE delivery_id = p_delivery AND finished_at IS NULL;
  END IF;
  UPDATE public.facebook_deliveries
  SET status = 'cancelled', updated_at = now(), active_attempt_id = NULL,
    message = CASE WHEN v_job.status IN ('pending','scheduled') THEN 'Cancelado antes del envío'
      ELSE 'Cancelado por decisión humana: preparación sin envío autorizado.' END
  WHERE id = p_delivery;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_facebook_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_facebook_delivery(uuid) TO authenticated;

ALTER FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb)
  RENAME TO facebook_worker_v2_before_pacing;
REVOKE ALL ON FUNCTION public.facebook_worker_v2_before_pacing(text, text, uuid, uuid, jsonb)
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
  v_device public.facebook_devices%ROWTYPE;
  v_policy public.fb_pacing_policy%ROWTYPE;
  v_job public.facebook_deliveries%ROWTYPE;
  v_publication public.facebook_publications%ROWTYPE;
  v_result jsonb;
  v_local_time time;
  v_local_day date;
  v_day_start timestamptz;
  v_marketplace_count integer;
  v_group_count integer;
  v_candidate_group_count integer;
  v_marketplace_cap integer;
  v_group_cap integer;
  v_warmup boolean;
BEGIN
  IF p_operation IS DISTINCT FROM 'claim' THEN
    RETURN public.facebook_worker_v2_before_pacing(p_token, p_operation, p_delivery, p_attempt, p_data);
  END IF;
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'DIAGNOSTIC_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS k(key) WHERE k.key <> 'claimKey')
    OR octet_length(p_data::text) > 30000 THEN
    RAISE EXCEPTION 'DIAGNOSTIC_INVALID';
  END IF;
  IF p_data->>'claimKey' IS NULL THEN
    RAISE EXCEPTION 'CLAIM_KEY_REQUIRED';
  END IF;

  SELECT device.* INTO v_device
  FROM public.facebook_devices AS device
  JOIN public.facebook_device_secrets AS secret ON secret.device_id = device.id
  WHERE device.revoked_at IS NULL
    AND secret.token_expires_at > now()
    AND secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  FOR UPDATE OF device;
  IF NOT FOUND THEN
    RETURN public.facebook_worker_v2_before_pacing(p_token, p_operation, p_delivery, p_attempt, p_data);
  END IF;
  IF v_device.capabilities IS NULL OR NOT (v_device.capabilities @> '["attempts"]'::jsonb)
    OR NOT (v_device.capabilities @> '["causal-results"]'::jsonb)
    OR NOT (v_device.capabilities @> '["recovery"]'::jsonb)
    OR NOT (v_device.capabilities @> '["result-candidates"]'::jsonb)
    OR NOT (v_device.capabilities @> '["causal-results-v2"]'::jsonb) THEN
    RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facebook_delivery_attempts
    WHERE device_id = v_device.id AND claim_key = (p_data->>'claimKey')::uuid) THEN
    RETURN public.facebook_worker_v2_before_pacing(p_token, p_operation, p_delivery, p_attempt, p_data);
  END IF;
  IF EXISTS (SELECT 1 FROM public.facebook_delivery_attempts WHERE device_id = v_device.id AND finished_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.facebook_deliveries WHERE device_id = v_device.id AND status = 'running' AND active_attempt_id IS NULL) THEN
    RAISE EXCEPTION 'ATTEMPT_RECOVERY_REQUIRED';
  END IF;
  IF NOT v_device.queue_enabled THEN RETURN NULL; END IF;

  INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_device.user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_device.user_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.fb_pacing_alerts AS alert
    WHERE alert.user_id = v_device.user_id AND alert.acknowledged_at IS NULL
      AND alert.created_at >= now() - make_interval(hours => v_policy.pause_on_warning_hours)
  ) THEN RETURN NULL; END IF;

  v_local_time := (now() AT TIME ZONE v_policy.timezone_name)::time;
  IF (v_policy.quiet_hours_start <> v_policy.quiet_hours_end
      AND v_policy.quiet_hours_start < v_policy.quiet_hours_end
      AND v_local_time >= v_policy.quiet_hours_start AND v_local_time < v_policy.quiet_hours_end)
    OR (v_policy.quiet_hours_start <> v_policy.quiet_hours_end
      AND v_policy.quiet_hours_start > v_policy.quiet_hours_end
      AND (v_local_time >= v_policy.quiet_hours_start OR v_local_time < v_policy.quiet_hours_end)) THEN
    RETURN NULL;
  END IF;
  IF v_policy.next_allowed_at IS NOT NULL AND v_policy.next_allowed_at > now() THEN RETURN NULL; END IF;

  v_local_day := (now() AT TIME ZONE v_policy.timezone_name)::date;
  v_day_start := v_local_day::timestamp AT TIME ZONE v_policy.timezone_name;
  v_warmup := v_local_day < v_policy.warmup_until;
  v_marketplace_cap := CASE WHEN v_warmup THEN greatest(1, floor(v_policy.daily_marketplace_cap::numeric / 2)::integer) ELSE v_policy.daily_marketplace_cap END;
  v_group_cap := CASE WHEN v_warmup THEN greatest(1, floor(v_policy.daily_group_cap::numeric / 2)::integer) ELSE v_policy.daily_group_cap END;

  UPDATE public.facebook_deliveries AS delivery
  SET status = 'pending', updated_at = now()
  FROM public.facebook_publications AS publication
  WHERE publication.id = delivery.publication_id AND publication.user_id = v_device.user_id
    AND delivery.status = 'scheduled' AND delivery.scheduled_at <= now();

  SELECT delivery.* INTO v_job
  FROM public.facebook_deliveries AS delivery
  JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
  WHERE publication.user_id = v_device.user_id
    AND delivery.status = 'pending' AND NOT delivery.recovery_required
    AND public.facebook_product_allowed(publication.approved_by, publication.product_id, true)
    AND NOT EXISTS (
      SELECT 1 FROM public.facebook_deliveries AS conflict
      JOIN public.facebook_publications AS conflict_publication ON conflict_publication.id = conflict.publication_id
      WHERE conflict_publication.user_id = publication.user_id
        AND conflict_publication.product_id = publication.product_id
        AND conflict.recovery_required
        AND public.facebook_destination_key(conflict.destination) = public.facebook_destination_key(delivery.destination)
    )
  ORDER BY publication.approved_at, (delivery.destination->>'mechanism' = 'marketplace') DESC, delivery.id
  FOR UPDATE OF delivery SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_publication FROM public.facebook_publications WHERE id = v_job.publication_id;
  IF v_job.destination->>'mechanism' IN ('marketplace','marketplace_groups') THEN
    SELECT count(*)::integer INTO v_marketplace_count
    FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE publication.user_id = v_device.user_id AND delivery.claimed_at >= v_day_start
      AND delivery.destination->>'mechanism' IN ('marketplace','marketplace_groups');
    IF v_marketplace_count >= v_marketplace_cap THEN RETURN NULL; END IF;
  END IF;
  IF v_job.destination->>'mechanism' IN ('group_direct','marketplace_groups') THEN
    SELECT coalesce(sum(group_count),0)::integer INTO v_group_count
    FROM (
      SELECT CASE WHEN delivery.destination->>'mechanism' = 'marketplace_groups'
        THEN (SELECT count(*) FROM public.fb_delivery_group_results AS result WHERE result.delivery_id = delivery.id)
        ELSE 1 END AS group_count
      FROM public.facebook_deliveries AS delivery
      JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
      WHERE publication.user_id = v_device.user_id AND delivery.claimed_at >= v_day_start
        AND delivery.destination->>'mechanism' IN ('group_direct','marketplace_groups')
    ) AS claimed_groups;
    v_candidate_group_count := CASE WHEN v_job.destination->>'mechanism' = 'marketplace_groups'
      THEN jsonb_array_length(v_job.target_groups) ELSE 1 END;
    IF v_group_count + v_candidate_group_count > v_group_cap THEN RETURN NULL; END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT result.group_id
        FROM public.fb_delivery_group_results AS result
        WHERE result.delivery_id = v_job.id
        UNION
        SELECT candidate_group.id
        FROM public.facebook_groups AS candidate_group
        WHERE v_job.destination->>'mechanism' = 'group_direct'
          AND candidate_group.user_id = v_device.user_id
          AND public.facebook_group_key(candidate_group.url) = public.facebook_group_key(v_job.destination->>'url')
      ) AS candidate_group
      JOIN public.facebook_groups AS group_row ON group_row.id = candidate_group.group_id
      WHERE EXISTS (
        SELECT 1
        FROM public.facebook_deliveries AS previous_delivery
        JOIN public.facebook_publications AS previous_publication ON previous_publication.id = previous_delivery.publication_id
        WHERE previous_publication.user_id = v_device.user_id
          AND previous_publication.product_id = v_publication.product_id
          AND previous_publication.id <> v_publication.id
          AND previous_delivery.status <> 'cancelled'
          AND coalesce(previous_delivery.submitted_at, previous_delivery.claimed_at, previous_publication.approved_at)
            >= now() - make_interval(days => v_policy.repeat_group_days)
          AND (
            (previous_delivery.destination->>'mechanism' = 'group_direct'
              AND public.facebook_group_key(previous_delivery.destination->>'url') = public.facebook_group_key(group_row.url))
            OR EXISTS (
              SELECT 1 FROM public.fb_delivery_group_results AS previous_group
              WHERE previous_group.delivery_id = previous_delivery.id AND previous_group.group_id = group_row.id
            )
          )
      )
    ) THEN RETURN NULL; END IF;
  END IF;

  v_result := public.facebook_worker_v2_before_pacing(p_token, p_operation, p_delivery, p_attempt, p_data);
  IF v_result ? 'id' AND coalesce((v_result->>'recovered')::boolean, false) = false THEN
    UPDATE public.fb_pacing_policy
    SET next_allowed_at = now() + make_interval(secs => v_policy.min_gap_seconds
      + v_policy.min_gap_seconds * v_policy.jitter_pct * random() / 100.0),
      updated_at = now()
    WHERE user_id = v_device.user_id;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb) TO anon, authenticated;

COMMIT;

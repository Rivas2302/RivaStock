BEGIN;

ALTER TABLE public.facebook_groups
  ADD COLUMN rules_summary text CHECK (rules_summary IS NULL OR char_length(rules_summary) <= 500),
  ADD COLUMN rules_hash text CHECK (rules_hash IS NULL OR rules_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN rules_checked_at timestamptz,
  ADD COLUMN allows_sales boolean,
  ADD COLUMN allows_links boolean,
  ADD COLUMN repeat_limit_days integer CHECK (repeat_limit_days IS NULL OR repeat_limit_days BETWEEN 1 AND 365),
  ADD COLUMN requires_approval boolean,
  ADD COLUMN safety_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN safety_pause_reason text CHECK (safety_pause_reason IS NULL OR char_length(safety_pause_reason) <= 300),
  ADD COLUMN safety_paused_at timestamptz;

ALTER TABLE public.fb_pacing_policy
  ADD COLUMN health_lock_at timestamptz,
  ADD COLUMN health_reviewed_at timestamptz,
  ADD COLUMN health_original_marketplace_cap integer CHECK (health_original_marketplace_cap IS NULL OR health_original_marketplace_cap BETWEEN 1 AND 100),
  ADD COLUMN health_original_group_cap integer CHECK (health_original_group_cap IS NULL OR health_original_group_cap BETWEEN 1 AND 500);

ALTER TABLE public.fb_supervision_requests
  ALTER COLUMN trace_id DROP NOT NULL,
  ADD COLUMN group_id uuid REFERENCES public.facebook_groups(id) ON DELETE CASCADE,
  DROP CONSTRAINT fb_supervision_requests_kind_check,
  ADD CONSTRAINT fb_supervision_requests_kind_check CHECK (kind IN (
    'recover_step', 'verify_result', 'review_content', 'review_photos', 'classify_warning', 'summarize_group_rules'
  )),
  ADD CONSTRAINT fb_supervision_group_rules_shape CHECK (
    (kind = 'summarize_group_rules' AND trace_id IS NULL AND group_id IS NOT NULL)
    OR (kind <> 'summarize_group_rules' AND trace_id IS NOT NULL AND group_id IS NULL)
  );

CREATE UNIQUE INDEX fb_supervision_group_rules_open_idx
  ON public.fb_supervision_requests(group_id)
  WHERE kind = 'summarize_group_rules' AND status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.fb_supervision_decision_valid(p_decision jsonb, p_dom_summary jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text;
  v_confidence numeric;
  v_repeat integer;
BEGIN
  IF p_dom_summary->'intent'->>'supervisor_kind' = 'summarize_group_rules' THEN
    IF jsonb_typeof(p_decision) IS DISTINCT FROM 'object' OR octet_length(p_decision::text) > 4096
      OR (SELECT count(*) FROM jsonb_object_keys(p_decision)) <> 6
      OR NOT (p_decision ?& ARRAY['summary','allows_sales','allows_links','repeat_limit_days','requires_approval','confidence'])
      OR jsonb_typeof(p_decision->'summary') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_decision->>'summary')) NOT BETWEEN 1 AND 500
      OR jsonb_typeof(p_decision->'confidence') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_decision) LOOP
      IF v_key NOT IN ('summary','allows_sales','allows_links','repeat_limit_days','requires_approval','confidence') THEN RETURN false; END IF;
    END LOOP;
    IF (jsonb_typeof(p_decision->'allows_sales') NOT IN ('boolean','null'))
      OR (jsonb_typeof(p_decision->'allows_links') NOT IN ('boolean','null'))
      OR (jsonb_typeof(p_decision->'requires_approval') NOT IN ('boolean','null'))
      OR (jsonb_typeof(p_decision->'repeat_limit_days') NOT IN ('number','null')) THEN RETURN false; END IF;
    IF jsonb_typeof(p_decision->'repeat_limit_days') = 'number' THEN
      IF p_decision->>'repeat_limit_days' !~ '^[0-9]{1,3}$' THEN RETURN false; END IF;
      v_repeat := (p_decision->>'repeat_limit_days')::integer;
      IF v_repeat NOT BETWEEN 1 AND 365 THEN RETURN false; END IF;
    END IF;
    v_confidence := (p_decision->>'confidence')::numeric;
    RETURN v_confidence BETWEEN 0.75 AND 1;
  END IF;

  IF jsonb_typeof(p_decision) IS DISTINCT FROM 'object'
    OR octet_length(p_decision::text) > 4096
    OR jsonb_typeof(p_dom_summary) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_dom_summary->'controls') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_decision->'action') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_decision->'confidence') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_decision->'observation') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_decision->'reason') IS DISTINCT FROM 'string'
    OR char_length(p_decision->>'observation') > 300
    OR char_length(p_decision->>'reason') > 300 THEN RETURN false; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_decision) LOOP
    IF v_key NOT IN ('action', 'element_index', 'text', 'wait_ms', 'confidence', 'observation', 'reason') THEN RETURN false; END IF;
  END LOOP;
  IF p_decision->>'action' NOT IN ('click', 'type', 'select_option', 'scroll_container', 'wait', 'reload', 'skip_destination', 'abort')
    OR (p_decision->>'confidence')::numeric NOT BETWEEN 0.6 AND 1 THEN RETURN false; END IF;
  IF p_decision->>'action' IN ('click', 'type', 'select_option', 'scroll_container') THEN
    IF jsonb_typeof(p_decision->'element_index') IS DISTINCT FROM 'number'
      OR p_decision->>'element_index' !~ '^(0|[1-9][0-9]?)$'
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_dom_summary->'controls') AS c
        WHERE c->>'index' = p_decision->>'element_index' AND coalesce(c->'state'->>'disabled','false') <> 'true') THEN RETURN false; END IF;
  ELSIF p_decision ? 'element_index' THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.facebook_group_rules(p_token text, p_operation text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.facebook_devices%ROWTYPE;
  v_group public.facebook_groups%ROWTYPE;
  v_group_id uuid;
  v_text text;
  v_hash text;
  v_targets jsonb;
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text) > 30000 THEN RAISE EXCEPTION 'GROUP_RULES_REQUEST_INVALID'; END IF;
  PERFORM public.facebook_worker(p_token, 'heartbeat');
  SELECT device.* INTO v_device
  FROM public.facebook_devices AS device
  JOIN public.facebook_device_secrets AS secret ON secret.device_id = device.id
  WHERE device.revoked_at IS NULL AND secret.token_expires_at > now()
    AND secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_REVOKED'; END IF;

  IF p_operation = 'targets' THEN
    IF p_data <> '{}'::jsonb THEN RAISE EXCEPTION 'GROUP_RULES_REQUEST_INVALID'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(targets)), '[]'::jsonb) INTO v_targets
    FROM (SELECT id AS group_id, url FROM public.facebook_groups AS group_row
      WHERE user_id = v_device.user_id AND (rules_checked_at IS NULL OR rules_checked_at < now() - interval '30 days')
        AND NOT EXISTS (SELECT 1 FROM public.fb_supervision_requests AS request
          WHERE request.group_id = group_row.id AND request.kind = 'summarize_group_rules'
            AND request.status IN ('pending','processing'))
      ORDER BY rules_checked_at NULLS FIRST, last_seen_at DESC NULLS LAST, name, id LIMIT 3) AS targets;
    RETURN jsonb_build_object('groups', v_targets);
  END IF;

  IF p_operation <> 'submit' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) AS item(key)
    WHERE item.key NOT IN ('group_id','rules_text'))
    OR coalesce(p_data->>'group_id','') !~ '^[0-9a-fA-F-]{36}$'
    OR jsonb_typeof(p_data->'rules_text') IS DISTINCT FROM 'string'
    OR char_length(p_data->>'rules_text') > 6000 THEN RAISE EXCEPTION 'GROUP_RULES_REQUEST_INVALID'; END IF;
  v_group_id := (p_data->>'group_id')::uuid;
  v_text := btrim(p_data->>'rules_text');
  SELECT * INTO v_group FROM public.facebook_groups WHERE id = v_group_id AND user_id = v_device.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_RULES_GROUP_INVALID'; END IF;
  IF v_text = '' THEN
    UPDATE public.facebook_groups SET rules_hash = NULL, rules_checked_at = now(), rules_summary = 'Sin reglas detectadas',
      allows_sales = NULL, allows_links = NULL, repeat_limit_days = NULL, requires_approval = NULL
    WHERE id = v_group_id AND user_id = v_device.user_id;
    RETURN jsonb_build_object('queued', false, 'no_rules_detected', true);
  END IF;
  -- This is only a stable change detector for public group rules, not a security credential.
  v_hash := md5(v_text) || md5('RivaStock-group-rules:' || v_text);
  IF v_group.rules_hash = v_hash THEN
    UPDATE public.facebook_groups SET rules_checked_at = now() WHERE id = v_group_id AND user_id = v_device.user_id;
    RETURN jsonb_build_object('queued', false, 'unchanged', true);
  END IF;
  INSERT INTO public.fb_supervision_requests(user_id, trace_id, group_id, step_seq, kind, intent, dom_summary)
  VALUES (v_device.user_id, NULL, v_group_id, 1, 'summarize_group_rules',
    jsonb_build_object('step','summarize_group_rules','intent_key','group-rules:'||v_group_id::text||':'||v_hash,
      'supervisor_kind','summarize_group_rules','group_id',v_group_id,'group_name',v_group.name,
      'group_url',v_group.url,'group_rules_hash',v_hash,'group_rules_text',v_text),
    jsonb_build_object('scope','page','controls','[]'::jsonb));
  UPDATE public.facebook_groups SET rules_hash = v_hash WHERE id = v_group_id AND user_id = v_device.user_id;
  RETURN jsonb_build_object('queued', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('queued', false, 'already_pending', true);
END;
$$;
REVOKE ALL ON FUNCTION public.facebook_group_rules(text, text, jsonb) FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facebook_group_rules(text, text, jsonb) TO anon;

CREATE FUNCTION public.fb_save_group_rules_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind = 'summarize_group_rules' AND NEW.status = 'answered' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.facebook_groups
    SET rules_summary = NEW.decision->>'summary',
      allows_sales = CASE WHEN jsonb_typeof(NEW.decision->'allows_sales') = 'boolean' THEN (NEW.decision->>'allows_sales')::boolean ELSE NULL END,
      allows_links = CASE WHEN jsonb_typeof(NEW.decision->'allows_links') = 'boolean' THEN (NEW.decision->>'allows_links')::boolean ELSE NULL END,
      repeat_limit_days = CASE WHEN jsonb_typeof(NEW.decision->'repeat_limit_days') = 'number' THEN (NEW.decision->>'repeat_limit_days')::integer ELSE NULL END,
      requires_approval = CASE WHEN jsonb_typeof(NEW.decision->'requires_approval') = 'boolean' THEN (NEW.decision->>'requires_approval')::boolean ELSE NULL END,
      rules_checked_at = NEW.answered_at
    WHERE id = NEW.group_id AND user_id = NEW.user_id
      AND rules_hash = NEW.intent->>'group_rules_hash';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_save_group_rules_summary() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER fb_supervision_save_group_rules_summary
  AFTER UPDATE OF status ON public.fb_supervision_requests
  FOR EACH ROW EXECUTE FUNCTION public.fb_save_group_rules_summary();

CREATE FUNCTION public.fb_pause_rejected_group(p_owner uuid, p_group uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_rejections integer;
BEGIN
  SELECT (SELECT count(*) FROM public.fb_delivery_group_results AS result
      JOIN public.facebook_deliveries AS delivery ON delivery.id = result.delivery_id
      JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
      WHERE publication.user_id = p_owner AND result.group_id = p_group AND result.status = 'not_approved'
        AND result.checked_at >= now() - interval '30 days')
    + (SELECT count(*) FROM public.facebook_deliveries AS delivery
      JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
      JOIN public.facebook_groups AS group_row ON group_row.user_id = publication.user_id
        AND public.facebook_group_key(group_row.url) = public.facebook_group_key(delivery.destination->>'url')
      WHERE publication.user_id = p_owner AND group_row.id = p_group
        AND delivery.destination->>'mechanism' = 'group_direct'
        AND delivery.issue->>'kind' = 'facebook_not_approved' AND delivery.updated_at >= now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM public.fb_delivery_group_results AS result WHERE result.delivery_id = delivery.id))
  INTO v_rejections;
  IF v_rejections >= 2 THEN
    UPDATE public.facebook_groups SET safety_paused = true,
      safety_pause_reason = 'Dos publicaciones rechazadas o eliminadas en los últimos 30 días.',
      safety_paused_at = coalesce(safety_paused_at, now())
    WHERE id = p_group AND user_id = p_owner AND NOT safety_paused;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pause_rejected_group(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fb_pause_rejected_group_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_owner uuid;
BEGIN
  IF NEW.status <> 'not_approved' THEN RETURN NEW; END IF;
  SELECT publication.user_id INTO v_owner FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE delivery.id = NEW.delivery_id;
  IF v_owner IS NOT NULL THEN PERFORM public.fb_pause_rejected_group(v_owner, NEW.group_id); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pause_rejected_group_result() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER fb_delivery_group_results_pause_rejected_group
  AFTER INSERT OR UPDATE OF status, checked_at ON public.fb_delivery_group_results
  FOR EACH ROW EXECUTE FUNCTION public.fb_pause_rejected_group_result();

CREATE FUNCTION public.fb_pause_rejected_direct_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_owner uuid; v_group uuid;
BEGIN
  IF NEW.destination->>'mechanism' <> 'group_direct' OR NEW.issue->>'kind' <> 'facebook_not_approved'
    OR NEW.updated_at < now() - interval '30 days' THEN RETURN NEW; END IF;
  SELECT publication.user_id INTO v_owner FROM public.facebook_publications AS publication WHERE publication.id = NEW.publication_id;
  FOR v_group IN SELECT group_row.id FROM public.facebook_groups AS group_row
    WHERE group_row.user_id = v_owner
      AND public.facebook_group_key(group_row.url) = public.facebook_group_key(NEW.destination->>'url') LOOP
    PERFORM public.fb_pause_rejected_group(v_owner, v_group);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_pause_rejected_direct_group() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER facebook_deliveries_pause_rejected_direct_group
  AFTER INSERT OR UPDATE OF issue, status, updated_at ON public.facebook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.fb_pause_rejected_direct_group();

CREATE FUNCTION public.fb_enforce_group_rule_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group_id uuid;
  v_group public.facebook_groups%ROWTYPE;
  v_policy public.fb_pacing_policy%ROWTYPE;
  v_repeat_days integer;
BEGIN
  IF jsonb_typeof(NEW.content->'price') IS DISTINCT FROM 'number'
    OR NOT EXISTS (SELECT 1 FROM public.products AS product WHERE product.id = NEW.product_id
      AND product.user_id = NEW.user_id AND round(product.sale_price, 2) = round((NEW.content->>'price')::numeric, 2)) THEN
    RAISE EXCEPTION 'El precio debe coincidir con el precio actual del producto';
  END IF;
  IF jsonb_typeof(NEW.content->'selection'->'groups') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  INSERT INTO public.fb_pacing_policy(user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = NEW.user_id;
  FOR v_group_id IN SELECT value::uuid FROM jsonb_array_elements_text(NEW.content->'selection'->'groups') AS value LOOP
    SELECT * INTO v_group FROM public.facebook_groups WHERE id = v_group_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Grupo inexistente o sin permiso'; END IF;
    IF v_group.safety_paused THEN RAISE EXCEPTION 'Este grupo está pausado por seguridad'; END IF;
    IF v_group.allows_sales IS FALSE THEN RAISE EXCEPTION 'Las reglas detectadas del grupo no permiten ventas'; END IF;
    v_repeat_days := greatest(v_policy.repeat_group_days, coalesce(v_group.repeat_limit_days, 0));
    IF EXISTS (
      SELECT 1 FROM public.facebook_deliveries AS delivery
      JOIN public.facebook_publications AS previous ON previous.id = delivery.publication_id
      WHERE previous.user_id = NEW.user_id AND previous.product_id = NEW.product_id
        AND coalesce(delivery.submitted_at, previous.approved_at) >= now() - make_interval(days => v_repeat_days)
        AND (public.facebook_group_key(delivery.destination->>'url') = public.facebook_group_key(v_group.url)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(delivery.target_groups,'[]'::jsonb)) target
            WHERE target->>'group_id' = v_group.id::text))
        AND delivery.destination->>'mechanism' IN ('group_direct','marketplace_groups')
    ) THEN RAISE EXCEPTION 'Este producto ya se publicó en el grupo dentro del intervalo mínimo de % días', v_repeat_days; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_enforce_group_rule_policy() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER facebook_publications_enforce_group_rule_policy
  BEFORE INSERT ON public.facebook_publications
  FOR EACH ROW EXECUTE FUNCTION public.fb_enforce_group_rule_policy();

CREATE FUNCTION public.fb_account_rejection_rate(p_owner uuid)
RETURNS TABLE(published_count bigint, rejected_count bigint, rejection_rate_pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH outcomes AS (
    SELECT result.status, result.checked_at
    FROM public.fb_delivery_group_results AS result
    JOIN public.facebook_deliveries AS delivery ON delivery.id = result.delivery_id
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE publication.user_id = p_owner AND result.status IN ('published','not_approved')
      AND result.checked_at >= now() - interval '30 days'
    UNION ALL
    SELECT CASE WHEN delivery.status = 'published' THEN 'published' ELSE 'not_approved' END,
      coalesce(delivery.updated_at, delivery.submitted_at)
    FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE publication.user_id = p_owner AND delivery.destination->>'mechanism' IN ('marketplace','group_direct')
      AND (delivery.status = 'published' OR delivery.issue->>'kind' = 'facebook_not_approved')
      AND coalesce(delivery.updated_at, delivery.submitted_at) >= now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM public.fb_delivery_group_results AS result WHERE result.delivery_id = delivery.id)
  ), totals AS (
    SELECT count(*) FILTER (WHERE status = 'published') AS published,
      count(*) FILTER (WHERE status = 'not_approved') AS rejected FROM outcomes
  )
  SELECT published, rejected,
    CASE WHEN published + rejected = 0 THEN 0::numeric ELSE round(100.0 * rejected / (published + rejected), 1) END
  FROM totals;
$$;
REVOKE ALL ON FUNCTION public.fb_account_rejection_rate(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fb_lock_high_rejection_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_owner uuid; v_rate numeric; v_policy public.fb_pacing_policy%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'fb_delivery_group_results' THEN
    SELECT publication.user_id INTO v_owner FROM public.facebook_deliveries AS delivery
      JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
      WHERE delivery.id = NEW.delivery_id;
  ELSE
    SELECT publication.user_id INTO v_owner FROM public.facebook_publications AS publication WHERE publication.id = NEW.publication_id;
  END IF;
  IF v_owner IS NULL THEN RETURN NEW; END IF;
  SELECT rejection_rate_pct INTO v_rate FROM public.fb_account_rejection_rate(v_owner);
  IF v_rate <= 20 THEN RETURN NEW; END IF;
  INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_owner) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_owner FOR UPDATE;
  IF v_policy.health_lock_at IS NULL THEN
    UPDATE public.fb_pacing_policy SET
      health_lock_at = now(),
      health_original_marketplace_cap = daily_marketplace_cap,
      health_original_group_cap = daily_group_cap,
      daily_marketplace_cap = greatest(1, floor(daily_marketplace_cap::numeric / 2)::integer),
      daily_group_cap = greatest(1, floor(daily_group_cap::numeric / 2)::integer)
    WHERE user_id = v_owner;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fb_lock_high_rejection_policy() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER fb_group_results_lock_high_rejection_policy
  AFTER INSERT OR UPDATE OF status, checked_at ON public.fb_delivery_group_results
  FOR EACH ROW EXECUTE FUNCTION public.fb_lock_high_rejection_policy();
CREATE TRIGGER fb_direct_deliveries_lock_high_rejection_policy
  AFTER INSERT OR UPDATE OF status, issue, updated_at ON public.facebook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.fb_lock_high_rejection_policy();

CREATE FUNCTION public.fb_account_health_get()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_owner uuid := public.get_owner_uid(auth.uid()); v_policy public.fb_pacing_policy%ROWTYPE; v_health jsonb; v_warnings jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_owner OR NOT public.has_permission(auth.uid(), 'config', 'read') THEN
    RAISE EXCEPTION 'Solo el dueño puede consultar la salud de la cuenta';
  END IF;
  INSERT INTO public.fb_pacing_policy(user_id) VALUES (v_owner) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_policy FROM public.fb_pacing_policy WHERE user_id = v_owner;
  SELECT jsonb_build_object('published_30d', published_count, 'rejected_30d', rejected_count, 'rejection_rate_pct', rejection_rate_pct)
  INTO v_health FROM public.fb_account_rejection_rate(v_owner);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', group_row.id, 'name', group_row.name, 'url', group_row.url,
      'reason', group_row.safety_pause_reason, 'paused_at', group_row.safety_paused_at)), '[]'::jsonb)
  INTO v_warnings FROM public.facebook_groups AS group_row WHERE group_row.user_id = v_owner AND group_row.safety_paused;
  RETURN jsonb_build_object(
    'policy', to_jsonb(v_policy) - 'user_id' - 'created_at',
    'published_today', (SELECT count(*) FROM public.facebook_deliveries AS delivery JOIN public.facebook_publications AS publication ON publication.id=delivery.publication_id
      WHERE publication.user_id=v_owner AND delivery.claimed_at >= date_trunc('day', now() AT TIME ZONE v_policy.timezone_name) AT TIME ZONE v_policy.timezone_name
        AND delivery.destination->>'mechanism' IN ('marketplace','marketplace_groups')),
    'group_posts_today', (SELECT coalesce(sum(group_count),0) FROM (
      SELECT CASE WHEN delivery.destination->>'mechanism'='marketplace_groups'
        THEN (SELECT count(*) FROM public.fb_delivery_group_results AS result WHERE result.delivery_id=delivery.id)
        ELSE 1 END AS group_count
      FROM public.facebook_deliveries AS delivery JOIN public.facebook_publications AS publication ON publication.id=delivery.publication_id
      WHERE publication.user_id=v_owner AND delivery.claimed_at >= date_trunc('day', now() AT TIME ZONE v_policy.timezone_name) AT TIME ZONE v_policy.timezone_name
        AND delivery.destination->>'mechanism' IN ('group_direct','marketplace_groups')) AS claimed_groups),
    'warmup_days_remaining', greatest(0, v_policy.warmup_until - (now() AT TIME ZONE v_policy.timezone_name)::date),
    'health_lock_active', v_policy.health_lock_at IS NOT NULL,
    'health', v_health,
    'paused_groups', v_warnings,
    'recent_alerts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', alert.id, 'warning_text', alert.warning_text, 'created_at', alert.created_at)), '[]'::jsonb)
      FROM (SELECT id, warning_text, created_at FROM public.fb_pacing_alerts WHERE user_id=v_owner AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 5) AS alert)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fb_account_health_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_account_health_get() TO authenticated;

CREATE FUNCTION public.fb_account_health_review()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_owner OR NOT public.has_permission(auth.uid(), 'config', 'write') THEN
    RAISE EXCEPTION 'Solo el dueño puede revisar la salud de la cuenta';
  END IF;
  UPDATE public.fb_pacing_policy SET health_reviewed_at = now(), health_lock_at = NULL,
    daily_marketplace_cap = coalesce(health_original_marketplace_cap, daily_marketplace_cap),
    daily_group_cap = coalesce(health_original_group_cap, daily_group_cap),
    health_original_marketplace_cap = NULL, health_original_group_cap = NULL
  WHERE user_id = v_owner;
  RETURN public.fb_account_health_get();
END;
$$;
REVOKE ALL ON FUNCTION public.fb_account_health_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_account_health_review() TO authenticated;

CREATE FUNCTION public.facebook_group_safety_reactivate(p_group uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_owner OR NOT public.has_permission(auth.uid(), 'config', 'write') THEN
    RAISE EXCEPTION 'Solo el dueño puede reactivar un grupo pausado';
  END IF;
  UPDATE public.facebook_groups SET safety_paused = false, safety_pause_reason = NULL, safety_paused_at = NULL
  WHERE id = p_group AND user_id = v_owner AND safety_paused;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.facebook_group_safety_reactivate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_group_safety_reactivate(uuid) TO authenticated;

COMMIT;

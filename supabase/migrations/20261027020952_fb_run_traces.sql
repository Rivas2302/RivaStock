BEGIN;

CREATE TABLE public.fb_run_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.facebook_devices(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES public.facebook_deliveries(id),
  attempt_id uuid REFERENCES public.facebook_delivery_attempts(id),
  mode text NOT NULL CHECK (mode IN ('real', 'rehearsal')),
  mechanism text NOT NULL CHECK (mechanism IN ('marketplace', 'group_direct')),
  extension_version text NOT NULL CHECK (char_length(extension_version) BETWEEN 1 AND 40),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('completed', 'aborted', 'failed', 'rehearsal_ok')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fb_run_traces_summary_object CHECK (jsonb_typeof(summary) = 'object'),
  CONSTRAINT fb_run_traces_summary_size CHECK (octet_length(summary::text) <= 20480),
  CONSTRAINT fb_run_traces_completion_pair CHECK ((finished_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT fb_run_traces_mode_links CHECK (
    (mode = 'real' AND delivery_id IS NOT NULL AND attempt_id IS NOT NULL)
    OR (mode = 'rehearsal' AND delivery_id IS NULL AND attempt_id IS NULL)
  )
);

CREATE INDEX fb_run_traces_user_started_idx
  ON public.fb_run_traces (user_id, started_at DESC);
CREATE INDEX fb_run_traces_retention_idx
  ON public.fb_run_traces (started_at);
CREATE INDEX fb_run_traces_delivery_idx
  ON public.fb_run_traces (delivery_id) WHERE delivery_id IS NOT NULL;

CREATE TABLE public.fb_trace_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL REFERENCES public.fb_run_traces(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 10000),
  step text NOT NULL CHECK (char_length(step) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('ok', 'retry', 'failed', 'supervised')),
  elapsed_ms integer NOT NULL CHECK (elapsed_ms >= 0),
  dom_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  screenshot_path text CHECK (screenshot_path IS NULL OR char_length(screenshot_path) <= 500),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fb_trace_steps_dom_summary_object CHECK (jsonb_typeof(dom_summary) = 'object'),
  CONSTRAINT fb_trace_steps_dom_summary_size CHECK (octet_length(dom_summary::text) <= 20480),
  CONSTRAINT fb_trace_steps_trace_seq_unique UNIQUE (trace_id, seq)
);

CREATE INDEX fb_trace_steps_trace_created_idx
  ON public.fb_trace_steps (trace_id, created_at);

-- A singleton row bounds cleanup to one invocation per hour across Edge isolates.
CREATE TABLE public.fb_trace_cleanup_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_cleanup_at timestamptz
);
INSERT INTO public.fb_trace_cleanup_state(singleton) VALUES (true);

ALTER TABLE public.fb_run_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_trace_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_trace_cleanup_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY fb_run_traces_owner_read
  ON public.fb_run_traces FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND user_id = (SELECT public.knowledge_owner_for('read'))
  );

CREATE POLICY fb_trace_steps_owner_read
  ON public.fb_trace_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.fb_run_traces AS trace
      WHERE trace.id = fb_trace_steps.trace_id
        AND trace.user_id = (SELECT auth.uid())
        AND trace.user_id = (SELECT public.knowledge_owner_for('read'))
    )
  );

REVOKE ALL ON TABLE public.fb_run_traces, public.fb_trace_steps, public.fb_trace_cleanup_state
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.fb_run_traces, public.fb_trace_steps TO authenticated;

CREATE OR REPLACE FUNCTION public.fb_trace_start(
  p_user_id uuid,
  p_device_id uuid,
  p_delivery_id uuid,
  p_attempt_id uuid,
  p_mode text,
  p_mechanism text,
  p_extension_version text,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trace_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_device_id IS NULL THEN
    RAISE EXCEPTION 'Trace owner and device are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.facebook_devices AS device
    WHERE device.id = p_device_id
      AND device.user_id = p_user_id
      AND device.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active Facebook device does not belong to trace owner';
  END IF;
  IF p_mode = 'real' THEN
    IF p_delivery_id IS NULL OR p_attempt_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.facebook_delivery_attempts AS attempt
      JOIN public.facebook_deliveries AS delivery ON delivery.id = attempt.delivery_id
      JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
      WHERE attempt.id = p_attempt_id
        AND delivery.id = p_delivery_id
        AND attempt.device_id = p_device_id
        AND publication.user_id = p_user_id
        AND delivery.destination->>'mechanism' = p_mechanism
    ) THEN
      RAISE EXCEPTION 'Trace delivery and attempt do not match owner, device, or mechanism';
    END IF;
  ELSIF p_mode = 'rehearsal' THEN
    IF p_delivery_id IS NOT NULL OR p_attempt_id IS NOT NULL THEN
      RAISE EXCEPTION 'Rehearsal traces cannot reference a live delivery or attempt';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid trace mode';
  END IF;

  INSERT INTO public.fb_run_traces (
    user_id, device_id, delivery_id, attempt_id, mode, mechanism,
    extension_version, summary
  ) VALUES (
    p_user_id, p_device_id, p_delivery_id, p_attempt_id, p_mode, p_mechanism,
    p_extension_version, COALESCE(p_summary, '{}'::jsonb)
  )
  RETURNING id INTO v_trace_id;

  RETURN v_trace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fb_trace_add_step(
  p_user_id uuid,
  p_trace_id uuid,
  p_seq integer,
  p_step text,
  p_status text,
  p_elapsed_ms integer,
  p_dom_summary jsonb DEFAULT '{}'::jsonb,
  p_screenshot_path text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.fb_run_traces AS trace
    WHERE trace.id = p_trace_id
      AND trace.user_id = p_user_id
      AND trace.finished_at IS NULL
      AND trace.started_at >= now() - interval '14 days'
  ) THEN
    RAISE EXCEPTION 'Open, unexpired trace does not belong to owner';
  END IF;

  INSERT INTO public.fb_trace_steps (
    trace_id, seq, step, status, elapsed_ms, dom_summary, screenshot_path, note
  ) VALUES (
    p_trace_id, p_seq, p_step, p_status, p_elapsed_ms,
    COALESCE(p_dom_summary, '{}'::jsonb), p_screenshot_path, p_note
  )
  RETURNING id INTO v_step_id;

  RETURN v_step_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fb_trace_finish(
  p_user_id uuid,
  p_trace_id uuid,
  p_outcome text,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.fb_run_traces%ROWTYPE;
BEGIN
  UPDATE public.fb_run_traces AS trace
  SET finished_at = now(), outcome = p_outcome,
      summary = COALESCE(p_summary, '{}'::jsonb)
  WHERE trace.id = p_trace_id
    AND trace.user_id = p_user_id
    AND trace.finished_at IS NULL
  RETURNING trace.* INTO v_existing;

  IF FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.fb_run_traces AS trace
  WHERE trace.id = p_trace_id AND trace.user_id = p_user_id;

  IF NOT FOUND OR v_existing.outcome IS DISTINCT FROM p_outcome
    OR v_existing.summary IS DISTINCT FROM COALESCE(p_summary, '{}'::jsonb) THEN
    RAISE EXCEPTION 'Trace is missing, belongs to another owner, or was already finished differently';
  END IF;
END;
$$;

-- Returns expired trace IDs and screenshot paths. The Edge Function deletes
-- Storage objects, then calls fb_traces_cleanup_finalize to remove the rows.
CREATE OR REPLACE FUNCTION public.fb_traces_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_cleanup timestamptz;
  v_traces jsonb;
BEGIN
  SELECT state.last_cleanup_at INTO v_last_cleanup
  FROM public.fb_trace_cleanup_state AS state
  WHERE state.singleton = true
  FOR UPDATE;

  IF v_last_cleanup IS NOT NULL AND v_last_cleanup > now() - interval '1 hour' THEN
    RETURN jsonb_build_object('due', false, 'traces', '[]'::jsonb);
  END IF;

  UPDATE public.fb_trace_cleanup_state
  SET last_cleanup_at = now()
  WHERE singleton = true;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'trace_id', expired.id,
        'screenshot_paths', COALESCE((
          SELECT jsonb_agg(step.screenshot_path ORDER BY step.seq)
          FROM public.fb_trace_steps AS step
          WHERE step.trace_id = expired.id AND step.screenshot_path IS NOT NULL
        ), '[]'::jsonb)
      )
      ORDER BY expired.started_at
    ),
    '[]'::jsonb
  ) INTO v_traces
  FROM (
    SELECT trace.id, trace.started_at
    FROM public.fb_run_traces AS trace
    WHERE trace.started_at < now() - interval '14 days'
    ORDER BY trace.started_at
    LIMIT 500
  ) AS expired;

  RETURN jsonb_build_object('due', true, 'traces', v_traces);
END;
$$;

CREATE OR REPLACE FUNCTION public.fb_traces_cleanup_finalize(p_trace_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_trace_ids IS NULL OR cardinality(p_trace_ids) > 500 THEN
    RAISE EXCEPTION 'Invalid cleanup trace batch';
  END IF;

  DELETE FROM public.fb_run_traces AS trace
  WHERE trace.id = ANY(p_trace_ids)
    AND trace.started_at < now() - interval '14 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.fb_trace_start(uuid, uuid, uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_trace_add_step(uuid, uuid, integer, text, text, integer, jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_trace_finish(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_traces_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fb_traces_cleanup_finalize(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.fb_trace_start(uuid, uuid, uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_trace_add_step(uuid, uuid, integer, text, text, integer, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_trace_finish(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_traces_cleanup() TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_traces_cleanup_finalize(uuid[]) TO service_role;

COMMIT;

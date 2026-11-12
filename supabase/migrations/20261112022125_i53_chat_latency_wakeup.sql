ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS timings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.ai_job_record_timing(
  p_owner uuid,
  p_worker_id uuid,
  p_job_id uuid,
  p_phase text,
  p_elapsed_ms integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_phase NOT IN ('context_ready_at', 'first_codex_event_at') THEN
    RAISE EXCEPTION 'Fase de medición inválida.';
  END IF;
  IF p_elapsed_ms IS NULL OR p_elapsed_ms < 0 OR p_elapsed_ms > 600000 THEN
    RAISE EXCEPTION 'Duración de medición inválida.';
  END IF;

  UPDATE public.ai_jobs AS job
  SET timings = COALESCE(job.timings, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      p_phase,
      COALESCE(NULLIF(job.timings->>'claimed_at', '')::timestamptz, pg_catalog.clock_timestamp())
        + (p_elapsed_ms * interval '1 millisecond')
    )
  WHERE job.id = p_job_id
    AND job.user_id = p_owner
    AND job.worker_id = p_worker_id
    AND job.status = 'processing'
    AND job.task_type = 'text_generation';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_job_record_timing(uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_job_record_timing(uuid, uuid, uuid, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ai_job_record_timing_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.task_type = 'text_generation' THEN
    NEW.timings := COALESCE(NEW.timings, '{}'::jsonb)
      || CASE WHEN NEW.timings ? 'created_at' THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('created_at', NEW.created_at) END;
    IF TG_OP = 'INSERT' THEN
      NULL;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'processing' THEN
      NEW.timings := COALESCE(NEW.timings, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('claimed_at', pg_catalog.clock_timestamp());
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed', 'failed') THEN
      NEW.timings := COALESCE(NEW.timings, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('response_final_at', pg_catalog.clock_timestamp());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_job_record_timing_status() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ai_jobs_record_timing_status
  BEFORE INSERT OR UPDATE OF status ON public.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.ai_job_record_timing_status();

CREATE OR REPLACE FUNCTION public.ai_bridge_wakeup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_owner := OLD.user_id;
  ELSE
    v_owner := NEW.user_id;
  END IF;
  IF v_owner IS NOT NULL THEN
    BEGIN
      PERFORM pg_catalog.pg_notify('bridge_wakeup', v_owner::text);
    EXCEPTION WHEN OTHERS THEN
      -- Notifications are an optimization; the bounded worker fallback remains safe.
      NULL;
    END;
    BEGIN
      PERFORM realtime.send(
        pg_catalog.jsonb_build_object('source', TG_TABLE_NAME),
        'pending_work',
        'bridge:' || v_owner::text,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      -- Keep the existing Realtime wakeup as a best-effort compatibility path.
      NULL;
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_bridge_wakeup() FROM PUBLIC, anon, authenticated;

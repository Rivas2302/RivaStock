BEGIN;

CREATE INDEX fb_run_traces_device_idx
  ON public.fb_run_traces (device_id);
CREATE INDEX fb_run_traces_attempt_idx
  ON public.fb_run_traces (attempt_id) WHERE attempt_id IS NOT NULL;

COMMIT;

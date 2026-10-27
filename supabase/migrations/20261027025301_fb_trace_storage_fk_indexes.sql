BEGIN;

CREATE INDEX fb_trace_storage_reservations_trace_idx
  ON public.fb_trace_storage_reservations (trace_id);

CREATE INDEX fb_trace_storage_reservations_user_created_idx
  ON public.fb_trace_storage_reservations (user_id, created_at);

COMMIT;

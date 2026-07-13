BEGIN;

-- The original audit function stored only `recorded_at` in some deployed
-- environments. Build the snapshots explicitly so deleted records retain
-- their name and all other fields in the traceability history.
CREATE OR REPLACE FUNCTION record_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_metadata jsonb := jsonb_build_object('recorded_at', now());
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_metadata := v_metadata || jsonb_build_object('before', to_jsonb(OLD));
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_metadata := v_metadata || jsonb_build_object('after', to_jsonb(NEW));
  END IF;

  INSERT INTO audit_events (user_id, actor_uid, action, entity_type, entity_id, metadata)
  VALUES (
    (v_row ->> 'user_id')::uuid,
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    v_row ->> 'id',
    v_metadata
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMIT;

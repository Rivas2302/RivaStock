BEGIN;

-- Audit rows must only be created by the database trigger. The old policy
-- allowed any authenticated client to forge records for its own tenant.
DROP POLICY IF EXISTS "audit_events_insert" ON audit_events;

CREATE OR REPLACE FUNCTION record_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_owner_uid uuid := (v_row ->> 'user_id')::uuid;
  v_metadata jsonb := jsonb_build_object('recorded_at', now());
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required to create an audit event'; END IF;
  IF v_owner_uid IS NULL THEN RAISE EXCEPTION 'Audit event requires an owning user'; END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_metadata := v_metadata || jsonb_build_object('before', to_jsonb(OLD)); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_metadata := v_metadata || jsonb_build_object('after', to_jsonb(NEW)); END IF;

  INSERT INTO audit_events (user_id, actor_uid, action, entity_type, entity_id, metadata)
  VALUES (v_owner_uid, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_row ->> 'id', v_metadata);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The trigger invokes this function with definer privileges; it is not a callable client API.
REVOKE ALL ON FUNCTION record_audit_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION record_audit_event() FROM anon;
REVOKE ALL ON FUNCTION record_audit_event() FROM authenticated;

-- Cash closings are operationally significant and must be captured by the
-- same immutable audit path instead of being written directly by the client.
DROP TRIGGER IF EXISTS cash_closings_audit_event ON cash_closings;
CREATE TRIGGER cash_closings_audit_event AFTER INSERT OR UPDATE OR DELETE ON cash_closings
  FOR EACH ROW EXECUTE FUNCTION record_audit_event();

COMMIT;

BEGIN;

CREATE TABLE cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  expected_cash numeric NOT NULL,
  counted_cash numeric NOT NULL,
  difference numeric NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_closings_user_date_idx ON cash_closings (user_id, date DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_uid uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_user_created_idx ON audit_events (user_id, created_at DESC);

ALTER TABLE cash_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_closings_select" ON cash_closings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "cash_closings_insert" ON cash_closings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "audit_events_select" ON audit_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "audit_events_insert" ON audit_events FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION record_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO audit_events (user_id, actor_uid, action, entity_type, entity_id, metadata)
  VALUES (
    (v_row ->> 'user_id')::uuid,
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    v_row ->> 'id',
    jsonb_build_object(
      'recorded_at', now(),
      'before', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'after', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER products_audit_event AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION record_audit_event();
CREATE TRIGGER cash_flow_audit_event AFTER INSERT OR UPDATE OR DELETE ON cash_flow
  FOR EACH ROW EXECUTE FUNCTION record_audit_event();
CREATE TRIGGER stock_intakes_audit_event AFTER INSERT OR UPDATE OR DELETE ON stock_intakes
  FOR EACH ROW EXECUTE FUNCTION record_audit_event();
CREATE TRIGGER sales_audit_event AFTER INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION record_audit_event();

COMMIT;

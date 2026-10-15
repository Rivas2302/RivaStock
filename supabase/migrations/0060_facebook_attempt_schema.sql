BEGIN;

-- Protocol-capability columns for devices. These are informative, never authoritative.
ALTER TABLE facebook_devices
  ADD COLUMN worker_protocol integer DEFAULT 1 CHECK (worker_protocol IN (1, 2)),
  ADD COLUMN extension_version text,
  ADD COLUMN capabilities jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN last_error_code text;

-- Link a delivery to its active attempt and flag contradictions that need review.
ALTER TABLE facebook_deliveries
  ADD COLUMN active_attempt_id uuid,
  ADD COLUMN recovery_required boolean DEFAULT false;

-- Per-tenant protocol policy. Required protocol only moves forward (1 -> 2).
CREATE TABLE facebook_worker_policy (
  user_id uuid PRIMARY KEY REFERENCES profiles(id),
  required_protocol integer NOT NULL DEFAULT 1 CHECK (required_protocol IN (1, 2)),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Attempt identity and lease. One live attempt per device; several devices per delivery.
CREATE TABLE facebook_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES facebook_deliveries(id),
  device_id uuid NOT NULL REFERENCES facebook_devices(id),
  claim_key uuid NOT NULL DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  authorized_at timestamptz,
  finished_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('submitted','published','pending_approval','interrupted','unknown','retired')),
  last_error_code text,
  evidence jsonb DEFAULT '{}'::jsonb,
  UNIQUE(device_id, claim_key)
);
CREATE INDEX facebook_delivery_attempts_delivery ON facebook_delivery_attempts(delivery_id);
CREATE INDEX facebook_delivery_attempts_device ON facebook_delivery_attempts(device_id);
CREATE INDEX facebook_delivery_attempts_active ON facebook_delivery_attempts(device_id) WHERE finished_at IS NULL;
ALTER TABLE facebook_deliveries ADD CONSTRAINT facebook_active_attempt_fk FOREIGN KEY(active_attempt_id) REFERENCES facebook_delivery_attempts(id);

-- Transition, late evidence and contradiction events. Deduplicated by idempotency key.
CREATE TABLE facebook_delivery_attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES facebook_delivery_attempts(id),
  type text NOT NULL CHECK (type IN ('claim','progress','checkpoint','authorize','submit','result','attention','issue','recover','review','contradiction','retire')),
  created_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  UNIQUE(attempt_id, idempotency_key)
);
CREATE INDEX facebook_delivery_attempt_events_attempt ON facebook_delivery_attempt_events(attempt_id);

-- RLS: access follows the parent delivery/publication ownership.
ALTER TABLE facebook_worker_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_delivery_attempt_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY facebook_worker_policy_read ON facebook_worker_policy FOR SELECT TO authenticated
  USING(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read'));
CREATE POLICY facebook_worker_policy_write ON facebook_worker_policy FOR ALL TO authenticated
  USING(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'config','write'))
  WITH CHECK(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'config','write'));

CREATE POLICY facebook_delivery_attempts_read ON facebook_delivery_attempts FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE d.id=delivery_id AND p.user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read')));
CREATE POLICY facebook_delivery_attempt_events_read ON facebook_delivery_attempt_events FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM facebook_delivery_attempts a JOIN facebook_deliveries d ON d.id=a.delivery_id
    JOIN facebook_publications p ON p.id=d.publication_id
    WHERE a.id=attempt_id AND p.user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read')));

REVOKE ALL ON facebook_worker_policy,facebook_delivery_attempts,facebook_delivery_attempt_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON facebook_worker_policy,facebook_delivery_attempts,facebook_delivery_attempt_events TO authenticated;

-- Monotonic protocol setting. Never downgrade an activated account to protocol 1.
CREATE FUNCTION set_facebook_worker_protocol(p_required integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_current integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid()<>get_owner_uid(auth.uid()) OR NOT has_permission(auth.uid(),'config','write') THEN
    RAISE EXCEPTION 'Solo el titular puede cambiar la política de protocolo';
  END IF;
  IF p_required IS NULL OR p_required NOT IN (1,2) THEN RAISE EXCEPTION 'Protocolo no válido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('facebook-protocol:'||auth.uid()::text,0));
  SELECT required_protocol INTO v_current FROM facebook_worker_policy WHERE user_id=get_owner_uid(auth.uid()) FOR UPDATE;
  IF v_current IS NOT NULL AND v_current > p_required THEN
    RAISE EXCEPTION 'No se puede bajar el protocolo requerido una vez activado en %', v_current;
  END IF;
  INSERT INTO facebook_worker_policy(user_id,required_protocol) VALUES(get_owner_uid(auth.uid()),p_required)
    ON CONFLICT(user_id) DO UPDATE SET required_protocol=EXCLUDED.required_protocol,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION set_facebook_worker_protocol(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION set_facebook_worker_protocol(integer) TO authenticated;

COMMIT;

BEGIN;

-- Protocol 2 worker dispatcher with attempt identity and lease.
CREATE FUNCTION facebook_worker_v2(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_device_id uuid; v_user_id uuid; v_device_queue_enabled boolean; v_device_queue_command_at text;
  v_policy integer;
  v_job facebook_deliveries; v_publication facebook_publications; v_attempt facebook_delivery_attempts;
  v_claim_key uuid; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT d.id, d.user_id, d.queue_enabled, d.queue_command_at
  INTO v_device_id, v_user_id, v_device_queue_enabled, v_device_queue_command_at
  FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
  WHERE d.revoked_at IS NULL AND s.token_expires_at>now()
    AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
  FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;
  IF NOT has_permission(v_user_id,'config','write') THEN RAISE EXCEPTION 'Conexión sin permiso'; END IF;

  v_policy := COALESCE((SELECT required_protocol FROM facebook_worker_policy WHERE user_id=v_user_id),1);

  UPDATE facebook_devices SET
    last_seen_at = v_now,
    worker_protocol = GREATEST(COALESCE(worker_protocol,1), 2),
    extension_version = left(p_data->>'version',40),
    capabilities = CASE WHEN jsonb_typeof(p_data->'capabilities')='array' THEN p_data->'capabilities' ELSE capabilities END,
    last_error_code = left(p_data->>'error_code',80)
  WHERE id=v_device_id;

  IF p_operation='heartbeat' THEN
    RETURN jsonb_build_object('connected',true,'queue_enabled',v_device_queue_enabled,'queue_command_at',v_device_queue_command_at,'required_protocol',v_policy);
  END IF;

  IF p_operation='queue_state' THEN
    DECLARE v_enabled boolean := (p_data->>'status')='active';
    BEGIN
      UPDATE facebook_devices SET queue_enabled=v_enabled, queue_command_at=v_now::text WHERE id=v_device_id;
      RETURN jsonb_build_object('queue_enabled',v_enabled,'queue_command_at',v_now::text);
    END;
  END IF;

  IF p_operation='claim' THEN
    v_claim_key := COALESCE((p_data->>'claimKey')::uuid, gen_random_uuid());
    -- Idempotent replay: an existing active attempt with the same claim key is returned as-is.
    SELECT a.* INTO v_attempt FROM facebook_delivery_attempts a
      WHERE a.device_id=v_device_id AND a.claim_key=v_claim_key AND a.finished_at IS NULL;
    IF FOUND THEN
      SELECT d.* INTO v_job FROM facebook_deliveries d WHERE d.id=v_attempt.delivery_id;
      SELECT * INTO v_publication FROM facebook_publications WHERE id=v_job.publication_id;
      RETURN jsonb_build_object('id',v_job.id,'attemptId',v_attempt.id,'claimKey',v_attempt.claim_key,'destination',v_job.destination,'content',v_publication.content);
    END IF;
    IF EXISTS(SELECT 1 FROM facebook_delivery_attempts WHERE device_id=v_device_id AND finished_at IS NULL) THEN
      RAISE EXCEPTION 'Hay un intento activo en esta PC. Usá recover antes de reclamar otro.';
    END IF;
    SELECT d.* INTO v_job FROM facebook_deliveries d
      JOIN facebook_publications p ON p.id=d.publication_id
      WHERE p.user_id=v_user_id AND d.status='pending'
      ORDER BY p.approved_at,(d.destination->>'mechanism'='marketplace') DESC,d.id
      FOR UPDATE OF d SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO facebook_delivery_attempts(delivery_id,device_id,claim_key,started_at,lease_expires_at)
      VALUES(v_job.id,v_device_id,v_claim_key,v_now,v_now+interval '2 minutes')
      RETURNING * INTO v_attempt;
    UPDATE facebook_deliveries SET status='running',device_id=v_device_id,claimed_at=v_now,updated_at=v_now,active_attempt_id=v_attempt.id
      WHERE id=v_job.id;
    SELECT * INTO v_publication FROM facebook_publications WHERE id=v_job.publication_id;
    RETURN jsonb_build_object('id',v_job.id,'attemptId',v_attempt.id,'claimKey',v_attempt.claim_key,'destination',v_job.destination,'content',v_publication.content);
  END IF;

  IF p_operation='progress' THEN
    SELECT * INTO v_attempt FROM facebook_delivery_attempts
      WHERE id=p_attempt AND device_id=v_device_id AND finished_at IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Intento no encontrado o no activo'; END IF;
    IF v_attempt.lease_expires_at < v_now THEN RAISE EXCEPTION 'La concesión del intento venció'; END IF;
    IF v_now > v_attempt.started_at + interval '10 minutes' THEN RAISE EXCEPTION 'El intento superó el tiempo máximo de preparación'; END IF;
    UPDATE facebook_delivery_attempts SET lease_expires_at=v_now+interval '2 minutes' WHERE id=v_attempt.id;
    RETURN jsonb_build_object('saved',true,'lease_expires_at',v_now+interval '2 minutes');
  END IF;

  IF p_operation='checkpoint' THEN
    SELECT a.* INTO v_attempt FROM facebook_delivery_attempts a
      JOIN facebook_deliveries d ON d.id=a.delivery_id
      JOIN facebook_publications p ON p.id=d.publication_id
      WHERE a.id=p_attempt AND a.device_id=v_device_id AND p.user_id=v_user_id AND a.finished_at IS NULL
      FOR UPDATE OF a;
    IF NOT FOUND THEN RAISE EXCEPTION 'Intento no encontrado'; END IF;
    SELECT d.* INTO v_job FROM facebook_deliveries d WHERE d.id=v_attempt.delivery_id FOR UPDATE OF d;
    SELECT * INTO v_publication FROM facebook_publications WHERE id=v_job.publication_id;
    IF v_job.status<>'running' OR NOT facebook_product_allowed(v_publication.approved_by,v_publication.product_id,true) THEN
      RAISE EXCEPTION 'El envío ya comenzó o se revocó el permiso';
    END IF;
    IF v_attempt.authorized_at IS NOT NULL THEN
      RETURN jsonb_build_object('authorized',false,'phase','authorized_before');
    END IF;
    UPDATE facebook_delivery_attempts SET authorized_at=v_now WHERE id=v_attempt.id;
    UPDATE facebook_deliveries SET submitted_at=v_now,updated_at=v_now,message='Formulario verificado; envío autorizado una sola vez' WHERE id=v_job.id;
    RETURN jsonb_build_object('authorized',true,'phase','authorized_now');
  END IF;

  RAISE EXCEPTION 'Operación V2 no habilitada: %', p_operation;
END;
$$;
REVOKE ALL ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker_v2(text,text,uuid,uuid,jsonb) TO anon,authenticated;

-- Preserve the most recent legacy dispatcher (0059 decisions wrapper or earlier) under a stable name.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='facebook_worker') THEN
    ALTER FUNCTION facebook_worker(text,text,uuid,text,text,text) RENAME TO facebook_worker_legacy_dispatch;
  END IF;
END $$;

REVOKE ALL ON FUNCTION facebook_worker_legacy_dispatch(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;

-- Replace the public legacy dispatcher with a gate that blocks V2-only accounts/deliveries.
CREATE OR REPLACE FUNCTION facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_policy integer; v_job facebook_deliveries; v_result jsonb; v_backend text;
BEGIN
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE d.revoked_at IS NULL AND s.token_expires_at>now() AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;
  v_policy := COALESCE((SELECT required_protocol FROM facebook_worker_policy WHERE user_id=v_device.user_id),1);
  IF p_operation IN ('claim','checkpoint') AND v_policy>=2 THEN
    RAISE EXCEPTION 'Esta cuenta requiere la versión actualizada de la extensión (protocolo 2)';
  END IF;
  IF p_delivery IS NOT NULL THEN
    SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
      WHERE d.id=p_delivery AND p.user_id=v_device.user_id;
    IF FOUND AND EXISTS(SELECT 1 FROM facebook_delivery_attempts WHERE delivery_id=v_job.id) AND p_operation IN ('attention','checkpoint','result','progress','issue','record_existing') THEN
      RAISE EXCEPTION 'Este envío usa el nuevo protocolo de intentos. Usá facebook_worker_v2.';
    END IF;
  END IF;
  IF p_operation='attention' AND v_job.device_id=v_device.id AND v_job.status='attention' THEN RETURN jsonb_build_object('saved',true,'retired',true); END IF;
  -- Dispatch to the highest available legacy backend.
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='facebook_worker_legacy_dispatch') THEN
    v_backend := 'facebook_worker_legacy_dispatch';
  ELSIF EXISTS(SELECT 1 FROM pg_proc WHERE proname='facebook_worker_base') THEN
    v_backend := 'facebook_worker_base';
  ELSE
    RAISE EXCEPTION 'No hay backend legado disponible';
  END IF;
  EXECUTE format('SELECT %I($1,$2,$3,$4,$5,$6)', v_backend) INTO v_result USING p_token,p_operation,p_delivery,p_message,p_status,p_url;
  -- Preserve the 0050 renewal behaviour that the 0051 wrapper added.
  UPDATE facebook_device_secrets s SET token_expires_at=now()+interval '30 days'
    FROM facebook_devices d WHERE d.id=s.device_id AND d.revoked_at IS NULL
    AND s.token_expires_at>now() AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF p_operation='heartbeat' THEN v_result:=v_result||jsonb_build_object('required_protocol',v_policy); END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION facebook_worker(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker(text,text,uuid,text,text,text) TO anon,authenticated;

-- Replace the old cleanup to leave V2 attempts untouched.
CREATE OR REPLACE FUNCTION facebook_worker_base(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_job facebook_deliveries; v_publication facebook_publications;
BEGIN
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE d.revoked_at IS NULL AND s.token_expires_at>now() AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;
  IF NOT has_permission(v_device.user_id,'config','write') THEN RAISE EXCEPTION 'Conexión sin permiso'; END IF;
  UPDATE facebook_devices SET last_seen_at=now() WHERE id=v_device.id;
  UPDATE facebook_deliveries d SET status='attention',message='Ejecución interrumpida. Verificá Facebook antes de repetir.',updated_at=now()
    FROM facebook_publications p WHERE p.id=d.publication_id AND p.user_id=v_device.user_id
      AND d.status='running' AND d.claimed_at<now()-interval '5 minutes' AND d.active_attempt_id IS NULL;
  IF p_operation='heartbeat' THEN RETURN jsonb_build_object('connected',true); END IF;
  IF p_operation='claim' THEN
    SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
      WHERE p.user_id=v_device.user_id AND d.status='pending' AND facebook_product_allowed(p.approved_by,p.product_id,true)
      ORDER BY p.approved_at,(d.destination->>'mechanism'='marketplace') DESC,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE facebook_deliveries SET status='running',device_id=v_device.id,claimed_at=now(),updated_at=now() WHERE id=v_job.id;
    SELECT * INTO v_publication FROM facebook_publications WHERE id=v_job.publication_id;
    RETURN jsonb_build_object('id',v_job.id,'destination',v_job.destination,'content',v_publication.content);
  END IF;
  IF p_operation='attention' THEN
    UPDATE facebook_deliveries SET status='attention',message=left(coalesce(p_message,'Requiere revisión'),1000),updated_at=now()
      WHERE id=p_delivery AND device_id=v_device.id AND status='running';
    IF NOT FOUND THEN RAISE EXCEPTION 'Envío no asignado a esta computadora'; END IF;
    RETURN jsonb_build_object('saved',true);
  END IF;
  IF p_operation IN ('checkpoint','result') THEN
    SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
      WHERE d.id=p_delivery AND d.device_id=v_device.id AND p.user_id=v_device.user_id FOR UPDATE OF d;
    IF NOT FOUND THEN RAISE EXCEPTION 'Envío no asignado a esta computadora'; END IF;
    SELECT * INTO v_publication FROM facebook_publications WHERE id=v_job.publication_id;
    IF p_operation='checkpoint' THEN
      IF v_job.status<>'running' OR v_job.submitted_at IS NOT NULL OR NOT facebook_product_allowed(v_publication.approved_by,v_publication.product_id,true) THEN
        RAISE EXCEPTION 'El envío ya comenzó o se revocó el permiso';
      END IF;
      UPDATE facebook_deliveries SET submitted_at=now(),updated_at=now(),message='Formulario verificado; envío autorizado una sola vez' WHERE id=v_job.id;
      RETURN jsonb_build_object('authorized',true);
    END IF;
    IF v_job.submitted_at IS NULL OR coalesce(p_status,'') NOT IN ('submitted','published','pending_approval') THEN RAISE EXCEPTION 'Resultado sin envío autorizado'; END IF;
    IF p_url IS NULL AND p_status<>'pending_approval' THEN RAISE EXCEPTION 'Falta el enlace del resultado'; END IF;
    IF p_url IS NOT NULL THEN
      IF v_job.destination->>'mechanism'='marketplace' THEN
        IF p_url !~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$' OR p_status='published' THEN RAISE EXCEPTION 'Evidencia inválida para Marketplace'; END IF;
      ELSE
        IF p_url !~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/posts/[0-9]+/?$'
          OR (split_part(p_url,'/',5)<>split_part(v_job.destination->>'url','/',5)
            AND NOT (split_part(v_job.destination->>'url','/',5) IN ('PicoVendedeTodo','710102875717376') AND split_part(p_url,'/',5) IN ('PicoVendedeTodo','710102875717376'))) THEN
          RAISE EXCEPTION 'El enlace no pertenece al grupo aprobado';
        END IF;
      END IF;
    END IF;
    IF v_job.status IN ('submitted','published','pending_approval') THEN
      IF v_job.status<>p_status OR v_job.evidence_url IS DISTINCT FROM p_url THEN RAISE EXCEPTION 'El resultado ya fue registrado'; END IF;
      RETURN jsonb_build_object('saved',true);
    END IF;
    IF v_job.status NOT IN ('running','attention') THEN RAISE EXCEPTION 'Estado incompatible'; END IF;
    UPDATE facebook_deliveries SET status=p_status,evidence_url=p_url,message=left(p_message,1000),updated_at=now() WHERE id=v_job.id;
    RETURN jsonb_build_object('saved',true);
  END IF;
  RAISE EXCEPTION 'Operación no habilitada';
END;
$$;

COMMIT;

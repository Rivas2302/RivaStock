BEGIN;

ALTER TABLE facebook_publications ADD COLUMN repeat_of uuid REFERENCES facebook_publications(id);
CREATE INDEX facebook_publications_product_history ON facebook_publications(user_id,product_id,approved_at DESC,id DESC);
CREATE INDEX facebook_publications_account_history ON facebook_publications(user_id,approved_at DESC,id DESC);

ALTER TABLE facebook_devices ADD COLUMN queue_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN queue_command_at timestamptz,
  ADD COLUMN execution_state text NOT NULL DEFAULT 'unknown' CHECK(execution_state IN ('unknown','active','paused')),
  ADD COLUMN current_activity text;

CREATE TABLE facebook_delivery_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES facebook_deliveries(id),
  reviewed_by uuid NOT NULL,
  decision text NOT NULL CHECK(decision IN ('found','not_found')),
  evidence_url text,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE facebook_delivery_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY facebook_reviews_read ON facebook_delivery_reviews FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM facebook_deliveries d WHERE d.id=delivery_id));
REVOKE ALL ON facebook_delivery_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON facebook_delivery_reviews TO authenticated;

CREATE FUNCTION facebook_evidence_matches(p_destination jsonb,p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT coalesce(CASE WHEN p_destination->>'mechanism'='marketplace'
    THEN p_url ~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$'
    WHEN p_destination->>'mechanism'='group_direct' THEN
      p_url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/posts/[0-9]+/?$'
      AND (split_part(p_url,'/',5)=split_part(p_destination->>'url','/',5)
        OR (split_part(p_url,'/',5) IN ('PicoVendedeTodo','710102875717376')
          AND split_part(p_destination->>'url','/',5) IN ('PicoVendedeTodo','710102875717376')))
    ELSE false END,false);
$$;
REVOKE ALL ON FUNCTION facebook_evidence_matches(jsonb,text) FROM PUBLIC,anon,authenticated;

-- Preserve the validated snapshot implementation; only this guarded entry
-- point is exposed. Lock by product, not by browser-local confirmation key.
ALTER FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean) RENAME TO approve_facebook_publication_base;
REVOKE ALL ON FUNCTION approve_facebook_publication_base(uuid,uuid,jsonb,uuid[],boolean) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION approve_facebook_publication(p_product uuid,p_intent uuid,p_content jsonb,p_groups uuid[],p_marketplace boolean,p_repeat_of uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=get_owner_uid(auth.uid()); v_latest uuid; v_keys text[]; v_exists boolean; v_id uuid;
BEGIN
  IF NOT facebook_product_allowed(auth.uid(),p_product,true) THEN RAISE EXCEPTION 'Sin permiso para publicar este producto'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||p_product::text,0));
  -- A lost acknowledgement is an idempotent retry, never a new publication.
  IF EXISTS(SELECT 1 FROM facebook_publications WHERE user_id=v_owner AND intent_key=p_intent) THEN
    RETURN approve_facebook_publication_base(p_product,p_intent,p_content,p_groups,p_marketplace);
  END IF;
  v_keys:=ARRAY(SELECT unnest(coalesce(p_groups,ARRAY[]::uuid[]))::text);
  IF p_marketplace THEN v_keys:=array_append(v_keys,'marketplace'); END IF;
  IF EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=v_owner AND p.product_id=p_product AND d.destination_key=ANY(v_keys)
      AND d.status IN ('pending','running')) THEN
    RAISE EXCEPTION 'Ya hay un trabajo pendiente o en ejecución para este destino. Consultá su historial.';
  END IF;
  IF EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=v_owner AND p.product_id=p_product AND d.destination_key=ANY(v_keys)
      AND d.status='attention' AND d.submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Resultado anterior desconocido. Revisá Facebook y registrá la revisión antes de habilitar otro envío.';
  END IF;
  SELECT EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=v_owner AND p.product_id=p_product AND d.destination_key=ANY(v_keys)) INTO v_exists;
  SELECT id INTO v_latest FROM facebook_publications WHERE user_id=v_owner AND product_id=p_product ORDER BY approved_at DESC,id DESC LIMIT 1;
  IF v_exists THEN
    IF p_repeat_of IS DISTINCT FROM v_latest THEN RAISE EXCEPTION 'Este producto tiene publicaciones anteriores. Elegí explícitamente preparar otra publicación y revisá sus destinos.'; END IF;
  ELSIF p_repeat_of IS NOT NULL AND p_repeat_of IS DISTINCT FROM v_latest THEN RAISE EXCEPTION 'La publicación anterior no corresponde a este producto';
  END IF;
  v_id:=approve_facebook_publication_base(p_product,p_intent,p_content,p_groups,p_marketplace);
  IF p_repeat_of IS NOT NULL THEN UPDATE facebook_publications SET repeat_of=p_repeat_of WHERE id=v_id; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION retry_facebook_preparation(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_product uuid; v_owner uuid;
BEGIN
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE d.id=p_delivery AND p.user_id=get_owner_uid(auth.uid()) AND facebook_product_allowed(auth.uid(),p.product_id,true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sin permiso para reintentar'; END IF;
  SELECT product_id,user_id INTO v_product,v_owner FROM facebook_publications WHERE id=v_job.publication_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||v_product::text,0));
  IF EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.product_id=v_product AND p.user_id=v_owner AND d.id<>p_delivery AND d.destination_key=v_job.destination_key
      AND (d.status IN ('pending','running') OR (d.status='attention' AND d.submitted_at IS NOT NULL))) THEN RAISE EXCEPTION 'Otro envío para este destino está pendiente o requiere revisión'; END IF;
  UPDATE facebook_deliveries d SET status='pending',device_id=NULL,claimed_at=NULL,updated_at=now(),message='Preparación reactivada por el usuario'
    FROM facebook_publications p WHERE d.id=p_delivery AND p.id=d.publication_id AND facebook_product_allowed(p.approved_by,p.product_id,true)
      AND d.status='attention' AND d.submitted_at IS NULL AND d.evidence_url IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se puede reintentar: el envío pudo comenzar o no tenés permiso'; END IF;
END;
$$;

CREATE FUNCTION review_facebook_delivery(p_delivery uuid,p_decision text,p_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries;
BEGIN
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE d.id=p_delivery AND p.user_id=get_owner_uid(auth.uid()) AND facebook_product_allowed(auth.uid(),p.product_id,true)
    FOR UPDATE OF d;
  IF NOT FOUND OR v_job.status<>'attention' OR v_job.submitted_at IS NULL THEN RAISE EXCEPTION 'El resultado no requiere revisión o no tenés permiso'; END IF;
  IF p_decision NOT IN ('found','not_found') OR p_decision IS NULL THEN RAISE EXCEPTION 'Elegí el resultado de tu revisión'; END IF;
  IF p_decision='found' AND NOT facebook_evidence_matches(v_job.destination,p_url) THEN RAISE EXCEPTION 'El enlace no corresponde al destino aprobado'; END IF;
  IF p_decision='not_found' AND p_url IS NOT NULL THEN RAISE EXCEPTION 'No incluyas un enlace si no encontraste la publicación'; END IF;
  INSERT INTO facebook_delivery_reviews(delivery_id,reviewed_by,decision,evidence_url) VALUES(p_delivery,auth.uid(),p_decision,p_url);
  UPDATE facebook_deliveries SET status=CASE WHEN p_decision='found' THEN 'submitted' ELSE 'cancelled' END,
    evidence_url=p_url,updated_at=now(),message=CASE WHEN p_decision='found'
      THEN 'Publicación encontrada e informada por el usuario. Aprobación pública sin verificar.'
      ELSE 'El usuario revisó Facebook y no encontró la publicación. Otro envío requiere una nueva aprobación explícita.' END
    WHERE id=p_delivery;
END;
$$;
REVOKE ALL ON FUNCTION review_facebook_delivery(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION review_facebook_delivery(uuid,text,text) TO authenticated;

CREATE FUNCTION set_facebook_queue_enabled(p_device uuid,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid()<>get_owner_uid(auth.uid()) OR NOT has_permission(auth.uid(),'config','write') OR p_enabled IS NULL THEN RAISE EXCEPTION 'Solo el titular puede gestionar la conexión'; END IF;
  UPDATE facebook_devices SET queue_enabled=p_enabled,queue_command_at=clock_timestamp()
    WHERE id=p_device AND user_id=auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Computadora inexistente o revocada'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION set_facebook_queue_enabled(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION set_facebook_queue_enabled(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; v_device facebook_devices; v_job facebook_deliveries;
BEGIN
  -- Always use the original capability/revocation checks and lock the device.
  result:=facebook_worker_base(p_token,'heartbeat');
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF p_operation='heartbeat' THEN
    UPDATE facebook_devices SET execution_state=CASE WHEN p_status IN ('active','paused') THEN p_status ELSE execution_state END,
      current_activity=coalesce(left(p_message,300),current_activity) WHERE id=v_device.id;
    result:=result||jsonb_build_object('queue_enabled',v_device.queue_enabled,'queue_command_at',v_device.queue_command_at);
  ELSIF p_operation='queue_state' THEN
    IF p_status IS NULL OR p_status NOT IN ('active','paused') THEN RAISE EXCEPTION 'Estado de cola inválido'; END IF;
    UPDATE facebook_devices SET queue_enabled=(p_status='active'),queue_command_at=clock_timestamp(),execution_state=p_status
      WHERE id=v_device.id RETURNING * INTO v_device;
    result:=jsonb_build_object('queue_enabled',v_device.queue_enabled,'queue_command_at',v_device.queue_command_at);
  ELSIF p_operation='progress' THEN
    UPDATE facebook_deliveries SET message=left(p_message,300),updated_at=now()
      WHERE id=p_delivery AND device_id=v_device.id AND status='running';
    IF NOT FOUND THEN RAISE EXCEPTION 'Envío no asignado a esta PC'; END IF;
    UPDATE facebook_devices SET current_activity=left(p_message,300) WHERE id=v_device.id;
    result:=jsonb_build_object('saved',true);
  ELSIF p_operation='record_existing' THEN
    SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
      WHERE d.id=p_delivery AND d.device_id=v_device.id AND p.user_id=v_device.user_id
        AND d.status='running' AND d.submitted_at IS NULL AND facebook_product_allowed(p.approved_by,p.product_id,true) FOR UPDATE OF d;
    IF NOT FOUND OR NOT facebook_evidence_matches(v_job.destination,p_url) THEN RAISE EXCEPTION 'No se pudo verificar el anuncio existente'; END IF;
    UPDATE facebook_deliveries SET status='submitted',evidence_url=p_url,updated_at=now(),
      message='Se encontró una publicación anterior en Facebook. No se creó un duplicado; aprobación pública sin verificar.' WHERE id=p_delivery;
    result:=jsonb_build_object('saved',true);
  ELSIF p_operation IN ('result','attention') AND EXISTS(
    SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
      JOIN facebook_delivery_reviews r ON r.delivery_id=d.id
      WHERE d.id=p_delivery AND d.device_id=v_device.id AND p.user_id=v_device.user_id
        AND d.status IN ('submitted','cancelled')
  ) THEN
    -- Let an offline PC retire its old journal after the user's explicit
    -- review. Late acknowledgements must not overwrite that resolution or
    -- permanently prevent this PC from processing other approved work.
    result:=jsonb_build_object('saved',true,'reviewed',true);
  ELSIF p_operation='claim' AND NOT v_device.queue_enabled THEN result:='null'::jsonb;
  ELSE
    result:=facebook_worker_base(p_token,p_operation,p_delivery,p_message,p_status,p_url);
    IF p_operation='claim' AND result IS DISTINCT FROM 'null'::jsonb THEN
      result:=jsonb_set(result,'{content,allowRepublish}',to_jsonb(EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id WHERE d.id=(result->>'id')::uuid AND p.repeat_of IS NOT NULL)));
    END IF;
  END IF;
  UPDATE facebook_device_secrets s SET token_expires_at=now()+interval '30 days' WHERE s.device_id=v_device.id;
  RETURN result;
END;
$$;
COMMIT;

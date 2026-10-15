BEGIN;
ALTER TABLE facebook_deliveries ADD COLUMN issue jsonb, ADD COLUMN resolution jsonb;
CREATE TABLE facebook_delivery_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES facebook_deliveries(id),
  user_id uuid NOT NULL, actor_id uuid NOT NULL,
  decision jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE facebook_delivery_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY facebook_decisions_read ON facebook_delivery_decisions FOR SELECT TO authenticated
  USING(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read'));
REVOKE ALL ON facebook_delivery_decisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON facebook_delivery_decisions TO authenticated;

ALTER FUNCTION facebook_worker(text,text,uuid,text,text,text) RENAME TO facebook_worker_before_decisions;
REVOKE ALL ON FUNCTION facebook_worker_before_decisions(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_data jsonb; v_device facebook_devices; v_job facebook_deliveries; v_item jsonb;
BEGIN
  IF p_operation='record_existing' THEN
    PERFORM facebook_worker_before_decisions(p_token,'heartbeat');
    IF p_url IS NULL OR p_url !~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$' THEN RAISE EXCEPTION 'No se pudo verificar el enlace del anuncio'; END IF;
    -- Older extensions must not associate a product by title either.
    RETURN facebook_worker(p_token,'issue',p_delivery,jsonb_build_object('kind','marketplace_conflict','message','Una extensión anterior encontró un anuncio. Confirmá su identidad o aprobá una publicación nueva.','candidates',jsonb_build_array(jsonb_build_object('title','Anuncio encontrado por una extensión anterior','url',p_url,'status',NULL,'summary','Identidad del producto sin confirmar')))::text);
  END IF;
  IF p_operation='issue' THEN
    PERFORM facebook_worker_before_decisions(p_token,'heartbeat');
    SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
    IF length(p_message)>30000 THEN RAISE EXCEPTION 'Diagnóstico demasiado extenso'; END IF;
    v_data:=p_message::jsonb;
    IF jsonb_typeof(v_data) IS DISTINCT FROM 'object' OR coalesce(v_data->>'kind','') NOT IN ('marketplace_conflict','group_sale_required','group_sale_fields','group_sale_audience') OR length(coalesce(v_data->>'message','')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Diagnóstico inválido'; END IF;
    IF v_data ? 'candidates' THEN
      IF jsonb_typeof(v_data->'candidates') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Candidatos inválidos'; END IF;
      IF jsonb_array_length(v_data->'candidates')>20 THEN RAISE EXCEPTION 'Demasiados candidatos'; END IF;
      FOR v_item IN SELECT value FROM jsonb_array_elements(v_data->'candidates') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR length(coalesce(v_item->>'title','')) NOT BETWEEN 1 AND 300 OR length(coalesce(v_item->>'summary',''))>600 OR length(coalesce(v_item->>'status',''))>80 OR (v_item->>'url' IS NOT NULL AND v_item->>'url' !~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$') THEN RAISE EXCEPTION 'Candidato inválido'; END IF;
      END LOOP;
    END IF;
    IF v_data ? 'fields' THEN
      IF jsonb_typeof(v_data->'fields') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Campos inválidos'; END IF;
      IF jsonb_array_length(v_data->'fields')>12 THEN RAISE EXCEPTION 'Demasiados campos'; END IF;
      FOR v_item IN SELECT value FROM jsonb_array_elements(v_data->'fields') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR length(coalesce(v_item->>'label','')) NOT BETWEEN 1 AND 160 OR coalesce(jsonb_typeof(v_item->'options'),'null') NOT IN ('null','array') THEN RAISE EXCEPTION 'Campo inválido'; END IF;
      END LOOP;
    END IF;
    SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
      WHERE d.id=p_delivery AND d.device_id=v_device.id AND p.user_id=v_device.user_id AND d.status='running' AND d.submitted_at IS NULL AND d.evidence_url IS NULL FOR UPDATE OF d;
    IF NOT FOUND THEN RAISE EXCEPTION 'El envío pudo comenzar o no está asignado a esta PC'; END IF;
    IF (v_data->>'kind'='marketplace_conflict') IS DISTINCT FROM (v_job.destination->>'mechanism'='marketplace') THEN RAISE EXCEPTION 'Diagnóstico incompatible con el destino'; END IF;
    UPDATE facebook_deliveries SET issue=v_data,status='attention',message=v_data->>'message',updated_at=now() WHERE id=p_delivery;
    RETURN jsonb_build_object('saved',true);
  END IF;
  v_data:=facebook_worker_before_decisions(p_token,p_operation,p_delivery,p_message,p_status,p_url);
  IF p_operation='claim' AND v_data->>'id' IS NOT NULL THEN
    SELECT * INTO v_job FROM facebook_deliveries WHERE id=(v_data->>'id')::uuid;
    -- Supplemental approval is scoped to one immutable delivery, never the product's other destinations.
    v_data:=jsonb_set(v_data,'{content,deliveryResolution}',coalesce(v_job.resolution,'{}'::jsonb));
    IF v_job.resolution->>'action'='new' THEN v_data:=jsonb_set(v_data,'{content,allowRepublish}','true'::jsonb); END IF;
  END IF;
  RETURN v_data;
END;
$$;
REVOKE ALL ON FUNCTION facebook_worker(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_worker(text,text,uuid,text,text,text) TO anon,authenticated;

ALTER FUNCTION retry_facebook_preparation(uuid) RENAME TO retry_facebook_preparation_before_decisions;
REVOKE ALL ON FUNCTION retry_facebook_preparation_before_decisions(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION retry_facebook_preparation(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM facebook_deliveries WHERE id=p_delivery AND issue->>'kind' IN ('marketplace_conflict','group_sale_required','group_sale_fields','group_sale_audience')) THEN RAISE EXCEPTION 'Este destino requiere una decisión; revisá su diagnóstico'; END IF;
  PERFORM retry_facebook_preparation_before_decisions(p_delivery);
END;
$$;
REVOKE ALL ON FUNCTION retry_facebook_preparation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION retry_facebook_preparation(uuid) TO authenticated;

CREATE FUNCTION resolve_facebook_delivery(p_delivery uuid,p_decision text,p_url text DEFAULT NULL,p_fields jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_publication facebook_publications; v_resolution jsonb; v_field jsonb;
BEGIN
  SELECT p.* INTO v_publication FROM facebook_publications p JOIN facebook_deliveries d ON d.publication_id=p.id
    WHERE d.id=p_delivery AND p.user_id=get_owner_uid(auth.uid()) AND facebook_product_allowed(auth.uid(),p.product_id,true) AND facebook_product_allowed(p.approved_by,p.product_id,true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sin permiso para resolver este destino'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_publication.user_id::text||v_publication.product_id::text,0));
  SELECT * INTO v_job FROM facebook_deliveries WHERE id=p_delivery FOR UPDATE;
  IF v_job.status<>'attention' OR v_job.submitted_at IS NOT NULL OR v_job.evidence_url IS NOT NULL THEN RAISE EXCEPTION 'El envío pudo comenzar o ya se resolvió. Revisá su resultado'; END IF;
  IF p_decision IN ('existing','new') THEN
    IF v_job.destination->>'mechanism'<>'marketplace' THEN RAISE EXCEPTION 'Decisión incompatible con el destino'; END IF;
    IF v_job.issue->>'kind' IS DISTINCT FROM 'marketplace_conflict' AND coalesce(v_job.message,'') !~* '(anuncio|título)' THEN RAISE EXCEPTION 'No hay un conflicto de anuncios para resolver'; END IF;
    IF p_decision='existing' AND (p_url IS NULL OR p_url !~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$') THEN RAISE EXCEPTION 'Ingresá el enlace público del anuncio que verificaste'; END IF;
  ELSIF p_decision='group_sale' THEN
    IF v_job.destination->>'mechanism'<>'group_direct' OR coalesce(v_job.issue->>'kind','') NOT IN ('group_sale_required','group_sale_fields') THEN RAISE EXCEPTION 'No hay un formulario de venta pendiente de aprobación'; END IF;
    IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR length(p_fields::text)>10000 THEN RAISE EXCEPTION 'Campos adicionales inválidos'; END IF;
    FOR v_field IN SELECT value FROM jsonb_array_elements(coalesce(v_job.issue->'fields','[]'::jsonb)) LOOP
      IF v_field->>'supported'='false' THEN RAISE EXCEPTION 'Control no compatible: %',v_field->>'label'; END IF;
      IF length(coalesce(p_fields->>(v_field->>'label'),'')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Falta completar: %',v_field->>'label'; END IF;
      IF jsonb_typeof(v_field->'options')='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_field->'options') o WHERE o->>'value'=p_fields->>(v_field->>'label')) THEN RAISE EXCEPTION 'Opción inválida para %',v_field->>'label'; END IF;
    END LOOP;
  ELSE RAISE EXCEPTION 'Decisión inválida'; END IF;
  v_resolution:=jsonb_build_object('action',p_decision,'url',p_url,'fields',p_fields,'actor',auth.uid(),'at',clock_timestamp());
  IF p_decision='existing' THEN
    v_resolution:=v_resolution||jsonb_build_object('observedStatus',(SELECT c->>'status' FROM jsonb_array_elements(coalesce(v_job.issue->'candidates','[]'::jsonb)) c WHERE c->>'url'=p_url LIMIT 1));
  END IF;
  -- The existing retry guard also checks other pending and unknown outcomes.
  PERFORM retry_facebook_preparation_before_decisions(p_delivery);
  UPDATE facebook_deliveries SET resolution=v_resolution,issue=NULL,
    status=CASE WHEN p_decision='existing' THEN 'submitted' ELSE 'pending' END,
    evidence_url=CASE WHEN p_decision='existing' THEN p_url ELSE NULL END,
    message=CASE WHEN p_decision='existing' THEN 'Anuncio vinculado por decisión del usuario. No se modificó ni se verificó su disponibilidad actual.' ELSE 'Decisión explícita guardada; esperando preparación de este destino' END WHERE id=p_delivery;
  INSERT INTO facebook_delivery_decisions(delivery_id,user_id,actor_id,decision) VALUES(p_delivery,v_publication.user_id,auth.uid(),v_resolution);
END;
$$;
REVOKE ALL ON FUNCTION resolve_facebook_delivery(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION resolve_facebook_delivery(uuid,text,text,jsonb) TO authenticated;
COMMIT;

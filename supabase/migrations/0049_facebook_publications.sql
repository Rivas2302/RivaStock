BEGIN;

-- Publication snapshots are immutable. Only RPCs may change queue state.
CREATE TABLE facebook_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  url text NOT NULL CHECK (url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/?$'),
  mechanism text NOT NULL DEFAULT 'group_direct' CHECK (mechanism = 'group_direct'),
  UNIQUE(user_id,url)
);
CREATE TABLE facebook_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Secrets have no client table access, including through SELECT *.
CREATE TABLE facebook_device_secrets (
  device_id uuid PRIMARY KEY REFERENCES facebook_devices(id),
  pairing_hash text,
  pairing_expires_at timestamptz,
  token_hash text,
  token_expires_at timestamptz
);
CREATE TABLE facebook_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  intent_key uuid NOT NULL,
  content jsonb NOT NULL,
  UNIQUE(user_id,intent_key)
);
CREATE TABLE facebook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES facebook_publications(id),
  destination jsonb NOT NULL,
  destination_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','submitted','published','pending_approval','attention','cancelled')),
  device_id uuid REFERENCES facebook_devices(id),
  claimed_at timestamptz,
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  message text,
  evidence_url text CHECK (evidence_url IS NULL OR evidence_url ~ '^https://www\.facebook\.com/(marketplace/item/[0-9]+|groups/[A-Za-z0-9._-]+/(posts|permalink)/[0-9]+)/?$'),
  UNIQUE(publication_id,destination_key)
);
CREATE INDEX facebook_deliveries_queue ON facebook_deliveries(status,updated_at);

CREATE FUNCTION facebook_product_allowed(p_actor uuid,p_product uuid,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p_actor IS NOT NULL AND has_permission(p_actor,'stock','read')
    AND (NOT p_write OR has_permission(p_actor,'stock','write'))
    AND EXISTS(SELECT 1 FROM products WHERE id=p_product AND user_id=get_owner_uid(p_actor));
$$;
REVOKE ALL ON FUNCTION facebook_product_allowed(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION facebook_product_allowed(uuid,uuid,boolean) TO authenticated;

ALTER TABLE facebook_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_device_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE facebook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY facebook_groups_read ON facebook_groups FOR SELECT TO authenticated USING(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read'));
CREATE POLICY facebook_groups_write ON facebook_groups FOR INSERT TO authenticated WITH CHECK(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','write'));
CREATE POLICY facebook_devices_read ON facebook_devices FOR SELECT TO authenticated USING(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read'));
CREATE POLICY facebook_publications_read ON facebook_publications FOR SELECT TO authenticated USING(user_id=get_owner_uid(auth.uid()) AND facebook_product_allowed(auth.uid(),product_id));
CREATE POLICY facebook_deliveries_read ON facebook_deliveries FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM facebook_publications p WHERE p.id=publication_id));
REVOKE ALL ON facebook_groups,facebook_devices,facebook_device_secrets,facebook_publications,facebook_deliveries FROM anon,authenticated;
GRANT SELECT,INSERT ON facebook_groups TO authenticated;
GRANT SELECT ON facebook_devices,facebook_publications,facebook_deliveries TO authenticated;

CREATE FUNCTION approve_facebook_publication(p_product uuid,p_intent uuid,p_content jsonb,p_groups uuid[],p_marketplace boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=get_owner_uid(auth.uid()); v_id uuid; v_existing facebook_publications; v_dest jsonb; v_group facebook_groups; v_photo text;
BEGIN
  IF NOT facebook_product_allowed(auth.uid(),p_product,true) THEN RAISE EXCEPTION 'Sin permiso para publicar este producto'; END IF;
  IF p_intent IS NULL OR p_marketplace IS NULL OR p_groups IS NULL OR cardinality(p_groups)>20 THEN RAISE EXCEPTION 'Destinos inválidos'; END IF;
  IF NOT p_marketplace AND cardinality(p_groups)=0 THEN RAISE EXCEPTION 'Elegí un destino'; END IF;
  IF cardinality(p_groups)>0 AND coalesce(length(btrim(p_content->>'groupText')),0) NOT BETWEEN 1 AND 6000 THEN RAISE EXCEPTION 'Falta el texto aprobado para los grupos'; END IF;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
    OR coalesce(length(btrim(p_content->>'title')),0) NOT BETWEEN 1 AND 100
    OR coalesce(length(btrim(p_content->>'description')),0) NOT BETWEEN 1 AND 5000
    OR jsonb_typeof(p_content->'price') IS DISTINCT FROM 'number'
    OR (p_content->>'price')::numeric <= 0
    OR (p_content->>'price')::numeric > 999999999
    OR coalesce(length(btrim(p_content->>'location')),0) NOT BETWEEN 1 AND 160
    OR coalesce(length(btrim(p_content->>'category')),0) NOT BETWEEN 1 AND 160
    OR coalesce(p_content->>'condition','') NOT IN ('new','like_new','good','fair')
    OR jsonb_typeof(p_content->'photos') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Completá título, descripción, precio, ubicación, categoría, condición y fotos'; END IF;
  IF jsonb_array_length(p_content->'photos') NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Elegí entre 1 y 10 fotos'; END IF;
  FOR v_photo IN SELECT jsonb_array_elements_text(p_content->'photos') LOOP
    IF v_photo !~ '^https://' OR NOT EXISTS(SELECT 1 FROM products p WHERE p.id=p_product AND (v_photo=p.image_url OR v_photo=ANY(p.images))) THEN
      RAISE EXCEPTION 'Las fotos deben pertenecer al producto';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_content->'photos')) <> jsonb_array_length(p_content->'photos') THEN RAISE EXCEPTION 'Fotos duplicadas'; END IF;
  IF (SELECT count(*) FROM facebook_groups WHERE user_id=v_owner AND id=ANY(p_groups)) <> cardinality(p_groups) THEN RAISE EXCEPTION 'Grupo inexistente, duplicado o sin permiso'; END IF;
  v_dest:=jsonb_build_object('marketplace',p_marketplace,'groups',to_jsonb(ARRAY(SELECT unnest(p_groups) ORDER BY 1)));
  -- Serialize confirmations, including concurrent duplicate HTTP requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||p_intent::text,0));
  SELECT * INTO v_existing FROM facebook_publications WHERE user_id=v_owner AND intent_key=p_intent;
  IF FOUND THEN
    IF v_existing.product_id<>p_product OR v_existing.content<>(p_content || jsonb_build_object('selection',v_dest)) THEN RAISE EXCEPTION 'Esta confirmación ya existe con otro contenido'; END IF;
    RETURN v_existing.id;
  END IF;
  INSERT INTO facebook_publications(user_id,product_id,approved_by,intent_key,content)
    VALUES(v_owner,p_product,auth.uid(),p_intent,p_content||jsonb_build_object('selection',v_dest)) RETURNING id INTO v_id;
  IF p_marketplace THEN
    INSERT INTO facebook_deliveries(publication_id,destination_key,destination) VALUES(v_id,'marketplace',jsonb_build_object('name','Marketplace','mechanism','marketplace','url','https://www.facebook.com/marketplace/create/item'));
  END IF;
  FOR v_group IN SELECT * FROM facebook_groups WHERE id=ANY(p_groups) AND user_id=v_owner LOOP
    INSERT INTO facebook_deliveries(publication_id,destination_key,destination) VALUES(v_id,v_group.id::text,jsonb_build_object('name',v_group.name,'url',v_group.url,'mechanism',v_group.mechanism));
  END LOOP;
  RETURN v_id;
END;
$$;

CREATE FUNCTION cancel_facebook_delivery(p_delivery uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE facebook_deliveries d SET status='cancelled',updated_at=now(),message='Cancelado antes del envío'
  FROM facebook_publications p WHERE d.id=p_delivery AND p.id=d.publication_id AND p.user_id=get_owner_uid(auth.uid())
    AND facebook_product_allowed(auth.uid(),p.product_id,true) AND d.status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'El envío ya comenzó o no tenés permiso'; END IF;
END;
$$;

CREATE FUNCTION pair_facebook_device(p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_code text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
BEGIN
  IF auth.uid() IS NULL OR auth.uid()<>get_owner_uid(auth.uid()) OR NOT has_permission(auth.uid(),'config','write') THEN RAISE EXCEPTION 'Solo el titular puede vincular una computadora'; END IF;
  INSERT INTO facebook_devices(user_id,name) VALUES(auth.uid(),p_name) RETURNING id INTO v_id;
  INSERT INTO facebook_device_secrets(device_id,pairing_hash,pairing_expires_at) VALUES(v_id,encode(sha256(convert_to(v_code,'UTF8')),'hex'),now()+interval '5 minutes');
  RETURN jsonb_build_object('deviceId',v_id,'code',v_code);
END;
$$;
CREATE FUNCTION redeem_facebook_device(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
BEGIN
  UPDATE facebook_device_secrets s SET pairing_hash=NULL,token_hash=encode(sha256(convert_to(v_token,'UTF8')),'hex'),token_expires_at=now()+interval '30 days'
    FROM facebook_devices d WHERE d.id=s.device_id AND d.revoked_at IS NULL AND s.pairing_expires_at>now() AND s.pairing_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') RETURNING s.device_id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Código vencido o utilizado'; END IF;
  RETURN jsonb_build_object('deviceId',v_id,'token',v_token);
END;
$$;
CREATE FUNCTION revoke_facebook_device(p_device uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE facebook_devices SET revoked_at=now() WHERE id=p_device AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Sin permiso'; END IF;
END;
$$;

-- A device capability authorizes only this queue, never general RivaStock access.
CREATE FUNCTION facebook_worker(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_message text DEFAULT NULL,p_status text DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_job facebook_deliveries; v_publication facebook_publications;
BEGIN
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE d.revoked_at IS NULL AND s.token_expires_at>now() AND s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;
  IF NOT has_permission(v_device.user_id,'config','write') THEN RAISE EXCEPTION 'Conexión sin permiso'; END IF;
  UPDATE facebook_devices SET last_seen_at=now() WHERE id=v_device.id;
  -- Never retry interrupted work: its external side effect may already exist.
  UPDATE facebook_deliveries d SET status='attention',message='Ejecución interrumpida. Verificá Facebook antes de repetir.',updated_at=now()
    FROM facebook_publications p WHERE p.id=d.publication_id AND p.user_id=v_device.user_id AND d.status='running' AND d.claimed_at<now()-interval '5 minutes';
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
      IF v_job.status<>'running' OR v_job.submitted_at IS NOT NULL OR NOT facebook_product_allowed(v_publication.approved_by,v_publication.product_id,true) THEN RAISE EXCEPTION 'El envío ya comenzó o se revocó el permiso'; END IF;
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
            AND NOT (split_part(v_job.destination->>'url','/',5) IN ('PicoVendedeTodo','710102875717376') AND split_part(p_url,'/',5) IN ('PicoVendedeTodo','710102875717376'))) THEN RAISE EXCEPTION 'El enlace no pertenece al grupo aprobado'; END IF;
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
REVOKE ALL ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean),cancel_facebook_delivery(uuid),pair_facebook_device(text),redeem_facebook_device(text),revoke_facebook_device(uuid),facebook_worker(text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean),cancel_facebook_delivery(uuid),pair_facebook_device(text),revoke_facebook_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_facebook_device(text),facebook_worker(text,text,uuid,text,text,text) TO anon,authenticated;
COMMIT;

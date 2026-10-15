BEGIN;
ALTER TABLE facebook_groups ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','session'));
ALTER TABLE facebook_groups ADD COLUMN last_seen_at timestamptz;
CREATE TABLE facebook_group_sync (
  user_id uuid PRIMARY KEY REFERENCES profiles(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES facebook_devices(id),
  status text NOT NULL CHECK(status IN ('requested','running','done','error')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  message text
);
ALTER TABLE facebook_group_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY facebook_group_sync_read ON facebook_group_sync FOR SELECT TO authenticated
  USING(user_id=get_owner_uid(auth.uid()) AND has_permission(auth.uid(),'stock','read'));
REVOKE ALL ON facebook_group_sync FROM PUBLIC,anon,authenticated;
GRANT SELECT ON facebook_group_sync TO authenticated;

CREATE FUNCTION request_facebook_groups(p_device uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=get_owner_uid(auth.uid()); v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'stock','write') THEN RAISE EXCEPTION 'Sin permiso para actualizar grupos'; END IF;
  IF NOT EXISTS(SELECT 1 FROM facebook_devices WHERE id=p_device AND user_id=v_owner AND revoked_at IS NULL) THEN RAISE EXCEPTION 'PC inexistente o revocada'; END IF;
  INSERT INTO facebook_group_sync(user_id,device_id,status) VALUES(v_owner,p_device,'requested')
    ON CONFLICT(user_id) DO UPDATE SET id=gen_random_uuid(),device_id=excluded.device_id,status='requested',requested_at=clock_timestamp(),finished_at=NULL,message=NULL
    WHERE facebook_group_sync.status IN ('done','error') OR facebook_group_sync.requested_at<now()-interval '5 minutes';
  SELECT id INTO v_id FROM facebook_group_sync WHERE user_id=v_owner;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION request_facebook_groups(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION request_facebook_groups(uuid) TO authenticated;

CREATE FUNCTION facebook_group_discovery(p_token text,p_operation text,p_request uuid DEFAULT NULL,p_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_device facebook_devices; v_request facebook_group_sync; item jsonb; v_url text; v_name text;
BEGIN
  -- Reuse capability expiry, revocation and device locking from the queue.
  PERFORM facebook_worker(p_token,'heartbeat');
  SELECT d.* INTO v_device FROM facebook_devices d JOIN facebook_device_secrets s ON s.device_id=d.id
    WHERE s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  SELECT * INTO v_request FROM facebook_group_sync WHERE user_id=v_device.user_id AND device_id=v_device.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_operation='claim' THEN
    IF v_request.status='running' AND v_request.requested_at<now()-interval '5 minutes' THEN
      UPDATE facebook_group_sync SET status='error',finished_at=now(),message='La lectura se interrumpió. Volvé a actualizar los grupos.' WHERE user_id=v_device.user_id;
      RETURN NULL;
    END IF;
    IF v_request.status<>'requested' THEN RETURN NULL; END IF;
    UPDATE facebook_group_sync SET status='running' WHERE user_id=v_device.user_id;
    RETURN jsonb_build_object('id',v_request.id);
  END IF;
  IF p_request IS DISTINCT FROM v_request.id OR v_request.status<>'running' THEN RAISE EXCEPTION 'Lectura no asignada a esta PC'; END IF;
  IF p_operation='result' THEN
    IF jsonb_typeof(p_data->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'groups')>1000 THEN RAISE EXCEPTION 'Listado de grupos inválido'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_data->'groups') LOOP
      v_url:=rtrim(item->>'url','/');v_name:=btrim(item->>'name');
      IF v_url='https://www.facebook.com/groups/PicoVendedeTodo' THEN v_url:='https://www.facebook.com/groups/710102875717376'; END IF;
      IF v_url IS NULL OR v_url !~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+$' OR coalesce(length(v_name),0) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Grupo sin identidad verificable'; END IF;
      -- Retain existing IDs, because approved jobs refer to them.
      UPDATE facebook_groups SET name=v_name,source='session',last_seen_at=now()
        WHERE user_id=v_device.user_id AND (rtrim(url,'/')=v_url OR (v_url='https://www.facebook.com/groups/710102875717376' AND rtrim(url,'/')='https://www.facebook.com/groups/PicoVendedeTodo'));
      IF NOT FOUND THEN
        INSERT INTO facebook_groups(user_id,name,url,source,last_seen_at) VALUES(v_device.user_id,v_name,v_url,'session',now());
      END IF;
    END LOOP;
    UPDATE facebook_group_sync SET status='done',finished_at=now(),message=CASE WHEN p_data->>'partial'='false'
      THEN 'Listado leído desde Tus grupos. Pertenecer no garantiza permiso para publicar.'
      ELSE 'Listado parcial: Facebook puede cargar más grupos. Los destinos anteriores se conservaron.' END WHERE user_id=v_device.user_id;
  ELSIF p_operation='error' THEN
    UPDATE facebook_group_sync SET status='error',finished_at=now(),message=left(coalesce(p_data->>'message','No se pudo leer Facebook.'),500) WHERE user_id=v_device.user_id;
  ELSE RAISE EXCEPTION 'Operación inválida'; END IF;
  RETURN jsonb_build_object('saved',true);
END;
$$;
REVOKE ALL ON FUNCTION facebook_group_discovery(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION facebook_group_discovery(text,text,uuid,jsonb) TO anon,authenticated;
-- UUIDs identify saved rows; the canonical URL identifies the actual destination.
CREATE FUNCTION facebook_group_key(p_url text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN rtrim(p_url,'/')='https://www.facebook.com/groups/PicoVendedeTodo' THEN 'https://www.facebook.com/groups/710102875717376' ELSE rtrim(p_url,'/') END;
$$;
ALTER FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) RENAME TO approve_facebook_publication_before_groups;
REVOKE ALL ON FUNCTION approve_facebook_publication_before_groups(uuid,uuid,jsonb,uuid[],boolean,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION approve_facebook_publication(p_product uuid,p_intent uuid,p_content jsonb,p_groups uuid[],p_marketplace boolean,p_repeat_of uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid:=get_owner_uid(auth.uid()); v_urls text[];
BEGIN
  IF NOT facebook_product_allowed(auth.uid(),p_product,true) THEN RAISE EXCEPTION 'Sin permiso para publicar este producto'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||p_product::text,0));
  IF EXISTS(SELECT 1 FROM facebook_publications WHERE user_id=v_owner AND intent_key=p_intent) THEN
    RETURN approve_facebook_publication_before_groups(p_product,p_intent,p_content,p_groups,p_marketplace,p_repeat_of);
  END IF;
  SELECT array_agg(facebook_group_key(url)) INTO v_urls FROM facebook_groups WHERE user_id=v_owner AND id=ANY(p_groups);
  IF cardinality(v_urls)<>(SELECT count(DISTINCT value) FROM unnest(v_urls) value) THEN RAISE EXCEPTION 'El mismo grupo aparece con más de una URL o identificador'; END IF;
  IF EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=v_owner AND p.product_id=p_product AND facebook_group_key(d.destination->>'url')=ANY(v_urls)
      AND (d.status IN ('pending','running') OR (d.status='attention' AND d.submitted_at IS NOT NULL))) THEN
    RAISE EXCEPTION 'Este grupo tiene un trabajo pendiente o un resultado desconocido. Revisá su historial.';
  END IF;
  IF p_repeat_of IS NULL AND EXISTS(SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=v_owner AND p.product_id=p_product AND facebook_group_key(d.destination->>'url')=ANY(v_urls)) THEN
    RAISE EXCEPTION 'Este grupo tiene publicaciones anteriores. Elegí explícitamente preparar otra publicación.';
  END IF;
  RETURN approve_facebook_publication_before_groups(p_product,p_intent,p_content,p_groups,p_marketplace,p_repeat_of);
END;
$$;
REVOKE ALL ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION approve_facebook_publication(uuid,uuid,jsonb,uuid[],boolean,uuid) TO authenticated;
ALTER FUNCTION retry_facebook_preparation(uuid) RENAME TO retry_facebook_preparation_before_groups;
REVOKE ALL ON FUNCTION retry_facebook_preparation_before_groups(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION retry_facebook_preparation(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_job facebook_deliveries; v_product uuid; v_owner uuid:=get_owner_uid(auth.uid());
BEGIN
  SELECT d.* INTO v_job FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE d.id=p_delivery AND p.user_id=v_owner AND facebook_product_allowed(auth.uid(),p.product_id,true);
  IF NOT FOUND THEN RAISE EXCEPTION 'Sin permiso para reintentar'; END IF;
  SELECT product_id INTO v_product FROM facebook_publications WHERE id=v_job.publication_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||v_product::text,0));
  IF v_job.destination->>'mechanism'='group_direct' AND EXISTS(
    SELECT 1 FROM facebook_deliveries d JOIN facebook_publications p ON p.id=d.publication_id
    WHERE p.user_id=v_owner AND p.product_id=v_product AND d.id<>p_delivery
      AND facebook_group_key(d.destination->>'url')=facebook_group_key(v_job.destination->>'url')
      AND (d.status IN ('pending','running') OR (d.status='attention' AND d.submitted_at IS NOT NULL))
  ) THEN RAISE EXCEPTION 'Otro envío para este grupo está pendiente o requiere revisión'; END IF;
  PERFORM retry_facebook_preparation_before_groups(p_delivery);
END;
$$;
REVOKE ALL ON FUNCTION retry_facebook_preparation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION retry_facebook_preparation(uuid) TO authenticated;
COMMIT;

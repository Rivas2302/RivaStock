-- Upgrade legacy HTTP Storage photo URLs at the client boundary while still
-- verifying that each HTTPS URL belongs to the approved product.
CREATE OR REPLACE FUNCTION approve_facebook_publication_base(
  p_product uuid,p_intent uuid,p_content jsonb,p_groups uuid[],p_marketplace boolean
)
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
    IF v_photo !~ '^https://' OR NOT EXISTS(
      SELECT 1 FROM products p WHERE p.id=p_product AND (
        v_photo=p.image_url OR v_photo=ANY(p.images)
        OR (position('/storage/v1/object/public/assets/' in v_photo)>0
          AND regexp_replace(v_photo,'^https://','http://')=p.image_url)
        OR (position('/storage/v1/object/public/assets/' in v_photo)>0
          AND regexp_replace(v_photo,'^https://','http://')=ANY(p.images))
      )
    ) THEN RAISE EXCEPTION 'Las fotos deben pertenecer al producto'; END IF;
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

REVOKE ALL ON FUNCTION approve_facebook_publication_base(uuid,uuid,jsonb,uuid[],boolean) FROM PUBLIC,anon,authenticated;

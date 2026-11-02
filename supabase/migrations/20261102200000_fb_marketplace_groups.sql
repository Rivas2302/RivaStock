BEGIN;

CREATE FUNCTION public.facebook_target_groups_valid(p_groups jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group jsonb;
  v_group_id text;
  v_name text;
  v_url text;
  v_canonical_id text;
  v_url_key text;
  v_key_count integer;
  v_ids text[] := ARRAY[]::text[];
  v_urls text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_groups) > 20 THEN RETURN false; END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    IF jsonb_typeof(v_group) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(v_group);
    IF v_key_count NOT IN (3, 4)
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_group) AS item(key)
        WHERE item.key NOT IN ('group_id', 'name', 'url', 'canonical_id')) THEN
      RETURN false;
    END IF;

    IF jsonb_typeof(v_group->'group_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_group->'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_group->'url') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    v_group_id := lower(v_group->>'group_id');
    v_name := btrim(v_group->>'name');
    v_url := v_group->>'url';
    IF v_group_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR char_length(v_name) NOT BETWEEN 1 AND 160
      OR v_url !~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/?$' THEN
      RETURN false;
    END IF;

    v_url_key := public.facebook_group_key(v_url);
    IF v_group_id = ANY(v_ids) OR v_url_key = ANY(v_urls) THEN RETURN false; END IF;
    v_ids := array_append(v_ids, v_group_id);
    v_urls := array_append(v_urls, v_url_key);

    IF v_group ? 'canonical_id' THEN
      IF jsonb_typeof(v_group->'canonical_id') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      v_canonical_id := v_group->>'canonical_id';
      IF char_length(v_canonical_id) NOT BETWEEN 1 AND 80
        OR v_canonical_id <> split_part(v_url_key, '/', 5) THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.facebook_target_groups_valid(jsonb)
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.facebook_deliveries
  ADD COLUMN target_groups jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.facebook_deliveries
  ADD CONSTRAINT facebook_deliveries_target_groups_check
  CHECK (
    public.facebook_target_groups_valid(target_groups)
    AND CASE
      WHEN destination->>'mechanism' = 'marketplace_groups'
        THEN jsonb_array_length(target_groups) BETWEEN 1 AND 20
      ELSE jsonb_array_length(target_groups) = 0
    END
  );

CREATE TABLE public.fb_delivery_group_results (
  delivery_id uuid NOT NULL REFERENCES public.facebook_deliveries(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES public.facebook_groups(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'selected', 'not_found_in_list', 'published', 'pending_approval', 'not_approved', 'unknown')),
  post_id text CHECK (post_id IS NULL OR post_id ~ '^[0-9]{1,30}$'),
  url text CHECK (url IS NULL OR url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/(posts|permalink)/[0-9]+/?$'),
  message text CHECK (message IS NULL OR char_length(message) <= 1000),
  checked_at timestamptz,
  PRIMARY KEY (delivery_id, group_id)
);

ALTER TABLE public.fb_delivery_group_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY fb_delivery_group_results_read ON public.fb_delivery_group_results
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE delivery.id = delivery_id
      AND publication.user_id = public.get_owner_uid(auth.uid())
      AND public.has_permission(auth.uid(), 'stock', 'read')
  ));
REVOKE ALL ON public.fb_delivery_group_results FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fb_delivery_group_results TO authenticated;
CREATE INDEX fb_delivery_group_results_group_status
  ON public.fb_delivery_group_results(group_id, status, checked_at DESC);

CREATE OR REPLACE FUNCTION public.facebook_destination_key(p_destination jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_destination->>'mechanism' IN ('marketplace', 'marketplace_groups') THEN 'marketplace'
    ELSE public.facebook_group_key(p_destination->>'url')
  END;
$$;
REVOKE ALL ON FUNCTION public.facebook_destination_key(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.facebook_valid_evidence_url(p_url text, p_destination jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(CASE
    WHEN p_destination->>'mechanism' IN ('marketplace', 'marketplace_groups')
      THEN p_url ~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$'
    ELSE p_url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/(posts|permalink)/[0-9]+/?$'
      AND public.facebook_group_key('https://www.facebook.com/groups/' || split_part(p_url, '/', 5))
        = public.facebook_group_key(p_destination->>'url')
  END, false);
$$;
REVOKE ALL ON FUNCTION public.facebook_valid_evidence_url(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.facebook_evidence_matches(p_destination jsonb, p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(CASE
    WHEN p_destination->>'mechanism' IN ('marketplace', 'marketplace_groups')
      THEN p_url ~ '^https://www\.facebook\.com/marketplace/item/[0-9]+/?$'
    WHEN p_destination->>'mechanism' = 'group_direct' THEN
      p_url ~ '^https://www\.facebook\.com/groups/[A-Za-z0-9._-]+/(posts|permalink)/[0-9]+/?$'
      AND public.facebook_group_key('https://www.facebook.com/groups/' || split_part(p_url, '/', 5))
        = public.facebook_group_key(p_destination->>'url')
    ELSE false
  END, false);
$$;
REVOKE ALL ON FUNCTION public.facebook_evidence_matches(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid,
  p_intent uuid,
  p_content jsonb,
  p_groups uuid[],
  p_marketplace boolean,
  p_mode text,
  p_repeat_of uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
  v_existing public.facebook_publications;
  v_group_count integer;
  v_url_count integer;
  v_group_ids uuid[];
  v_group_urls text[];
  v_target_groups jsonb;
  v_selection jsonb;
  v_snapshot jsonb;
  v_latest uuid;
  v_has_history boolean;
  v_delivery_id uuid;
  v_id uuid;
  v_photo text;
BEGIN
  IF p_mode = 'separate' THEN
    RETURN public.approve_facebook_publication(p_product, p_intent, p_content, p_groups, p_marketplace, p_repeat_of);
  END IF;

  IF p_mode IS DISTINCT FROM 'marketplace_groups' OR p_marketplace IS DISTINCT FROM true
    OR NOT public.facebook_product_allowed(auth.uid(), p_product, true)
    OR p_intent IS NULL OR p_groups IS NULL OR cardinality(p_groups) NOT BETWEEN 1 AND 20
    OR coalesce(char_length(btrim(p_content->>'groupText')), 0) NOT BETWEEN 1 AND 6000 THEN
    RAISE EXCEPTION 'Destinos inválidos o sin permiso';
  END IF;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
    OR coalesce(char_length(btrim(p_content->>'title')), 0) NOT BETWEEN 1 AND 100
    OR coalesce(char_length(btrim(p_content->>'description')), 0) NOT BETWEEN 1 AND 5000
    OR jsonb_typeof(p_content->'price') IS DISTINCT FROM 'number'
    OR (p_content->>'price')::numeric <= 0
    OR (p_content->>'price')::numeric > 999999999
    OR coalesce(char_length(btrim(p_content->>'location')), 0) NOT BETWEEN 1 AND 160
    OR coalesce(char_length(btrim(p_content->>'category')), 0) NOT BETWEEN 1 AND 160
    OR coalesce(p_content->>'condition', '') NOT IN ('new', 'like_new', 'good', 'fair')
    OR jsonb_typeof(p_content->'photos') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Completá título, descripción, precio, ubicación, categoría, condición y fotos';
  END IF;
  IF jsonb_array_length(p_content->'photos') NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Elegí entre 1 y 10 fotos';
  END IF;
  FOR v_photo IN SELECT jsonb_array_elements_text(p_content->'photos') LOOP
    IF v_photo !~ '^https://' OR NOT EXISTS (
      SELECT 1 FROM public.products AS product
      WHERE product.id = p_product AND (v_photo = product.image_url OR v_photo = ANY(product.images))
    ) THEN
      RAISE EXCEPTION 'Las fotos deben pertenecer al producto';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_content->'photos'))
    <> jsonb_array_length(p_content->'photos') THEN
    RAISE EXCEPTION 'Fotos duplicadas';
  END IF;

  PERFORM 1 FROM public.facebook_groups
  WHERE user_id = v_owner AND id = ANY(p_groups)
  ORDER BY id FOR SHARE;
  SELECT count(*) INTO v_group_count
  FROM public.facebook_groups WHERE user_id = v_owner AND id = ANY(p_groups);
  IF v_group_count <> cardinality(p_groups) THEN
    RAISE EXCEPTION 'Grupo inexistente, duplicado o sin permiso';
  END IF;

  SELECT array_agg(group_row.id ORDER BY group_row.id),
    array_agg(public.facebook_group_key(group_row.url) ORDER BY public.facebook_group_key(group_row.url)),
    jsonb_agg(jsonb_build_object(
      'group_id', group_row.id,
      'name', group_row.name,
      'url', group_row.url,
      'canonical_id', split_part(public.facebook_group_key(group_row.url), '/', 5)
    ) ORDER BY group_row.id),
    count(DISTINCT public.facebook_group_key(group_row.url))
  INTO v_group_ids, v_group_urls, v_target_groups, v_url_count
  FROM public.facebook_groups AS group_row
  WHERE group_row.user_id = v_owner AND group_row.id = ANY(p_groups);
  IF v_url_count <> cardinality(p_groups) OR NOT public.facebook_target_groups_valid(v_target_groups) THEN
    RAISE EXCEPTION 'El mismo grupo aparece con más de una URL o identificador';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_product::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_intent::text, 0));
  v_selection := jsonb_build_object('marketplace', true, 'groups', to_jsonb(v_group_ids), 'mode', 'marketplace_groups');
  v_snapshot := p_content || jsonb_build_object('selection', v_selection);

  SELECT * INTO v_existing FROM public.facebook_publications
  WHERE user_id = v_owner AND intent_key = p_intent FOR UPDATE;
  IF FOUND THEN
    IF v_existing.product_id <> p_product OR v_existing.content IS DISTINCT FROM v_snapshot THEN
      RAISE EXCEPTION 'Esta confirmación ya existe con otro contenido';
    END IF;
    SELECT delivery.id INTO v_delivery_id
    FROM public.facebook_deliveries AS delivery
    WHERE delivery.publication_id = v_existing.id
      AND delivery.destination_key = 'marketplace'
      AND delivery.destination->>'mechanism' = 'marketplace_groups'
      AND delivery.target_groups = v_target_groups;
    IF NOT FOUND OR (SELECT count(*) FROM public.facebook_deliveries WHERE publication_id = v_existing.id) <> 1 THEN
      RAISE EXCEPTION 'Esta confirmación ya existe con otros destinos';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE publication.user_id = v_owner AND publication.product_id = p_product
      AND (delivery.destination_key = 'marketplace'
        OR public.facebook_group_key(delivery.destination->>'url') = ANY(v_group_urls))
      AND (delivery.status IN ('pending', 'running')
        OR (delivery.status = 'attention' AND delivery.submitted_at IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Este destino tiene un trabajo pendiente o un resultado desconocido. Revisá su historial.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE publication.user_id = v_owner AND publication.product_id = p_product
      AND coalesce(delivery.recovery_required, false)
      AND (delivery.destination_key = 'marketplace'
        OR public.facebook_group_key(delivery.destination->>'url') = ANY(v_group_urls))
  ) THEN
    RAISE EXCEPTION 'RECOVERY_REQUIRED';
  END IF;

  SELECT publication.id INTO v_latest
  FROM public.facebook_publications AS publication
  WHERE publication.user_id = v_owner AND publication.product_id = p_product
  ORDER BY publication.approved_at DESC, publication.id DESC LIMIT 1;
  SELECT EXISTS (
    SELECT 1 FROM public.facebook_deliveries AS delivery
    JOIN public.facebook_publications AS publication ON publication.id = delivery.publication_id
    WHERE publication.user_id = v_owner AND publication.product_id = p_product
      AND (delivery.destination_key = 'marketplace'
        OR public.facebook_group_key(delivery.destination->>'url') = ANY(v_group_urls))
  ) INTO v_has_history;
  IF v_has_history AND p_repeat_of IS DISTINCT FROM v_latest THEN
    RAISE EXCEPTION 'Este producto tiene publicaciones anteriores. Elegí explícitamente preparar otra publicación y revisá sus destinos.';
  ELSIF NOT v_has_history AND p_repeat_of IS NOT NULL AND p_repeat_of IS DISTINCT FROM v_latest THEN
    RAISE EXCEPTION 'La publicación anterior no corresponde a este producto';
  END IF;

  INSERT INTO public.facebook_publications(user_id, product_id, approved_by, intent_key, content, repeat_of)
  VALUES (v_owner, p_product, auth.uid(), p_intent, v_snapshot, p_repeat_of)
  RETURNING id INTO v_id;
  INSERT INTO public.facebook_deliveries(publication_id, destination_key, destination, target_groups)
  VALUES (v_id, 'marketplace', jsonb_build_object(
    'name', 'Marketplace',
    'mechanism', 'marketplace_groups',
    'url', 'https://www.facebook.com/marketplace/create/item'
  ), v_target_groups)
  RETURNING id INTO v_delivery_id;
  INSERT INTO public.fb_delivery_group_results(delivery_id, group_id)
  SELECT v_delivery_id, unnest(v_group_ids);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
  TO authenticated;

ALTER FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb)
  RENAME TO facebook_worker_v2_before_marketplace_groups;
REVOKE ALL ON FUNCTION public.facebook_worker_v2_before_marketplace_groups(text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.facebook_worker_v2(
  p_token text,
  p_operation text,
  p_delivery uuid DEFAULT NULL,
  p_attempt uuid DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_target_groups jsonb;
BEGIN
  v_result := public.facebook_worker_v2_before_marketplace_groups(p_token, p_operation, p_delivery, p_attempt, p_data);
  IF p_operation = 'claim' AND v_result IS NOT NULL AND v_result ? 'id' THEN
    SELECT delivery.target_groups INTO v_target_groups
    FROM public.facebook_deliveries AS delivery
    WHERE delivery.id = (v_result->>'id')::uuid;
    RETURN v_result || jsonb_build_object('target_groups', coalesce(v_target_groups, '[]'::jsonb));
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb) TO anon, authenticated;

COMMIT;

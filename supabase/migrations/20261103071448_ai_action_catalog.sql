CREATE TABLE public.ai_actions_catalog (
  action_key text PRIMARY KEY,
  description text NOT NULL,
  parameters_schema jsonb NOT NULL CHECK (jsonb_typeof(parameters_schema) = 'object'),
  requires_confirmation boolean NOT NULL DEFAULT true CHECK (requires_confirmation),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_actions_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_actions_catalog FROM PUBLIC, anon, authenticated;

INSERT INTO public.ai_actions_catalog (action_key, description, parameters_schema, requires_confirmation)
VALUES (
  'facebook.publish_product',
  'Prepare a Facebook product publication draft for owner review. It never publishes until the owner confirms it in RivaStock.',
  '{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "required": ["product_id", "marketplace", "group_mode", "use_ai_copy"],
    "properties": {
      "product_id": {"type": "string", "format": "uuid"},
      "marketplace": {"type": "boolean"},
      "groups": {"type": "array", "items": {"type": "string", "format": "uuid"}, "uniqueItems": true, "maxItems": 20},
      "group_mode": {"type": "string", "enum": ["marketplace_groups", "separate"]},
      "use_ai_copy": {"type": "boolean"},
      "schedule_at": {"type": "string", "format": "date-time"}
    },
    "allOf": [
      {"if": {"properties": {"group_mode": {"const": "marketplace_groups"}}, "required": ["group_mode"]}, "then": {"properties": {"marketplace": {"const": true}, "groups": {"type": "array", "minItems": 1}}}},
      {"if": {"properties": {"marketplace": {"const": false}}, "required": ["marketplace"]}, "then": {"properties": {"groups": {"type": "array", "minItems": 1}}}}
    ]
  }'::jsonb,
  true
);

CREATE TABLE public.ai_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_key text NOT NULL REFERENCES public.ai_actions_catalog(action_key) ON DELETE RESTRICT,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 80 AND btrim(source) = source),
  params jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  draft_content jsonb NOT NULL CHECK (jsonb_typeof(draft_content) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  publication_id uuid,
  confirmed_params jsonb,
  confirmed_content jsonb,
  confirmed_repeat_of uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (
    (status = 'pending' AND publication_id IS NULL AND confirmed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'confirmed' AND publication_id IS NOT NULL AND confirmed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND publication_id IS NULL AND confirmed_at IS NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX ai_action_requests_pending_idx
  ON public.ai_action_requests (user_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.ai_action_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_action_requests_owner_read
  ON public.ai_action_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.ai_action_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_action_requests TO authenticated;

CREATE FUNCTION public.ai_action_normalize_facebook_publish_params(p_user_id uuid, p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
  v_product public.products%ROWTYPE;
  v_groups uuid[] := ARRAY[]::uuid[];
  v_group_count integer := 0;
  v_photo_count integer := 0;
  v_mode text;
  v_marketplace boolean;
  v_use_ai_copy boolean;
  v_schedule timestamptz;
  v_params jsonb;
  v_images text[];
  v_image_url text;
BEGIN
  IF p_user_id IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Solicitud de acción inválida';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_params) AS item(key)
    WHERE item.key NOT IN ('product_id', 'marketplace', 'groups', 'group_mode', 'use_ai_copy', 'schedule_at')
  ) THEN
    RAISE EXCEPTION 'La solicitud contiene parámetros no admitidos';
  END IF;
  IF NOT (p_params ? 'product_id')
    OR jsonb_typeof(p_params->'product_id') IS DISTINCT FROM 'string'
    OR (p_params->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_params->'marketplace') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_params->'group_mode') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_params->'use_ai_copy') IS DISTINCT FROM 'boolean'
    OR (p_params ? 'groups' AND jsonb_typeof(p_params->'groups') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'La solicitud no coincide con el esquema de facebook.publish_product';
  END IF;

  v_product_id := (p_params->>'product_id')::uuid;
  v_marketplace := (p_params->>'marketplace')::boolean;
  v_mode := p_params->>'group_mode';
  v_use_ai_copy := (p_params->>'use_ai_copy')::boolean;
  IF v_mode NOT IN ('marketplace_groups', 'separate') THEN
    RAISE EXCEPTION 'El modo de destinos no es válido';
  END IF;

  IF p_params ? 'groups' THEN
    IF jsonb_array_length(p_params->'groups') > 20
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_params->'groups') AS item(value)
        WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
          OR (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) THEN
      RAISE EXCEPTION 'La lista de grupos no es válida';
    END IF;
    SELECT COALESCE(array_agg(value::uuid ORDER BY ordinality), ARRAY[]::uuid[])
    INTO v_groups
    FROM jsonb_array_elements_text(p_params->'groups') WITH ORDINALITY AS item(value, ordinality);
    IF cardinality(v_groups) <> (SELECT count(DISTINCT value) FROM unnest(v_groups) AS item(value)) THEN
      RAISE EXCEPTION 'No se permiten grupos duplicados';
    END IF;
  END IF;
  IF (v_mode = 'marketplace_groups' AND (NOT v_marketplace OR cardinality(v_groups) = 0))
    OR (NOT v_marketplace AND cardinality(v_groups) = 0) THEN
    RAISE EXCEPTION 'Elegí Marketplace o al menos un grupo compatible con el modo seleccionado';
  END IF;

  SELECT count(*) INTO v_group_count
  FROM public.facebook_groups AS group_row
  WHERE group_row.user_id = p_user_id AND group_row.id = ANY(v_groups);
  IF v_group_count <> cardinality(v_groups) THEN
    RAISE EXCEPTION 'Uno o más grupos no pertenecen a la cuenta';
  END IF;

  IF p_params ? 'schedule_at' THEN
    IF jsonb_typeof(p_params->'schedule_at') IS DISTINCT FROM 'string'
      OR (p_params->>'schedule_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'La fecha programada debe incluir zona horaria';
    END IF;
    BEGIN
      v_schedule := (p_params->>'schedule_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'La fecha programada no es válida';
    END;
    IF v_schedule <= now() THEN RAISE EXCEPTION 'La fecha programada debe ser futura'; END IF;
  END IF;

  SELECT * INTO v_product FROM public.products AS product
  WHERE product.id = v_product_id AND product.user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el producto'; END IF;
  v_images := v_product.images;
  v_image_url := v_product.image_url;

  SELECT count(*) INTO v_photo_count
  FROM (
    SELECT photo.url
    FROM (
      SELECT image_url AS url, ordinality
      FROM unnest(COALESCE(v_images, ARRAY[]::text[])) WITH ORDINALITY AS image(image_url, ordinality)
      UNION ALL
      SELECT v_image_url, 10001::bigint
    ) AS photo
    WHERE photo.url IS NOT NULL AND photo.url <> ''
    GROUP BY photo.url
  ) AS unique_photos;
  IF v_photo_count = 0 THEN RAISE EXCEPTION 'El producto necesita al menos una foto para Facebook'; END IF;

  v_params := jsonb_build_object(
    'product_id', v_product_id,
    'marketplace', v_marketplace,
    'groups', to_jsonb(v_groups),
    'group_mode', v_mode,
    'use_ai_copy', v_use_ai_copy
  );
  IF v_schedule IS NOT NULL THEN
    v_params := v_params || jsonb_build_object('schedule_at', to_char(v_schedule AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  RETURN v_params;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_normalize_facebook_publish_params(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.request_ai_action(p_action text, p_params jsonb, p_source text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_params jsonb;
  v_product public.products%ROWTYPE;
  v_photos jsonb;
  v_id uuid;
  v_images text[];
  v_image_url text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede solicitar acciones de IA';
  END IF;
  IF p_action IS DISTINCT FROM 'facebook.publish_product'
    OR NOT EXISTS (SELECT 1 FROM public.ai_actions_catalog WHERE action_key = p_action AND requires_confirmation) THEN
    RAISE EXCEPTION 'La acción no está disponible';
  END IF;
  IF p_source IS NULL OR p_source !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$' THEN
    RAISE EXCEPTION 'El origen de la acción no es válido';
  END IF;

  v_params := public.ai_action_normalize_facebook_publish_params(v_actor, p_params);
  SELECT * INTO v_product FROM public.products
  WHERE id = (v_params->>'product_id')::uuid AND user_id = v_actor;
  v_images := v_product.images;
  v_image_url := v_product.image_url;
  SELECT COALESCE(jsonb_agg(photo.url ORDER BY photo.ordinality), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT unique_photo.url, min(unique_photo.ordinality) AS ordinality
    FROM (
      SELECT image_url AS url, ordinality
      FROM unnest(COALESCE(v_images, ARRAY[]::text[])) WITH ORDINALITY AS image(image_url, ordinality)
      UNION ALL
      SELECT v_image_url, 10001::bigint
    ) AS unique_photo
    WHERE unique_photo.url IS NOT NULL AND unique_photo.url <> ''
    GROUP BY unique_photo.url
    ORDER BY min(unique_photo.ordinality)
    LIMIT 10
  ) AS photo;

  INSERT INTO public.ai_action_requests (user_id, action_key, source, params, draft_content)
  VALUES (
    v_actor,
    p_action,
    p_source,
    v_params,
    jsonb_build_object(
      'title', left(v_product.name, 100),
      'description', left(COALESCE(v_product.description, ''), 5000),
      'price', v_product.sale_price,
      'photos', v_photos,
      'location', '',
      'category', '',
      'condition', 'new',
      'schedule_at', v_params->'schedule_at'
    )
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_ai_action(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_ai_action(text, jsonb, text) TO authenticated;

CREATE FUNCTION public.cancel_ai_action(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.ai_action_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede descartar acciones';
  END IF;
  SELECT * INTO v_request FROM public.ai_action_requests
  WHERE id = p_request_id AND user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la solicitud'; END IF;
  IF v_request.status = 'cancelled' THEN RETURN true; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'La solicitud ya fue confirmada'; END IF;
  UPDATE public.ai_action_requests
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = v_request.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_ai_action(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ai_action(uuid) TO authenticated;

CREATE FUNCTION public.confirm_ai_action(
  p_request_id uuid,
  p_params jsonb,
  p_content jsonb,
  p_repeat_of uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.ai_action_requests%ROWTYPE;
  v_params jsonb;
  v_groups uuid[] := ARRAY[]::uuid[];
  v_publication uuid;
  v_schedule text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede confirmar acciones';
  END IF;
  SELECT * INTO v_request FROM public.ai_action_requests
  WHERE id = p_request_id AND user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la solicitud'; END IF;
  IF v_request.status = 'confirmed' THEN
    IF p_params IS DISTINCT FROM v_request.confirmed_params
      OR p_content IS DISTINCT FROM v_request.confirmed_content
      OR p_repeat_of IS DISTINCT FROM v_request.confirmed_repeat_of THEN
      RAISE EXCEPTION 'La solicitud ya fue confirmada con otros datos';
    END IF;
    RETURN v_request.publication_id;
  END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'La solicitud ya fue descartada'; END IF;
  IF v_request.action_key <> 'facebook.publish_product' THEN RAISE EXCEPTION 'La acción no está disponible'; END IF;

  v_params := public.ai_action_normalize_facebook_publish_params(v_actor, p_params);
  IF (v_params->>'product_id') IS DISTINCT FROM (v_request.params->>'product_id') THEN
    RAISE EXCEPTION 'La solicitud no puede cambiar de producto';
  END IF;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_content->'photos') IS DISTINCT FROM 'array'
    OR (p_content->>'schedule_at') IS DISTINCT FROM (v_params->>'schedule_at') THEN
    RAISE EXCEPTION 'El borrador de publicación no coincide con sus parámetros';
  END IF;
  IF v_params ? 'schedule_at' THEN
    v_schedule := v_params->>'schedule_at';
    IF v_schedule !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR v_schedule::timestamptz <= now() THEN
      RAISE EXCEPTION 'La fecha programada debe seguir siendo futura';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(value::uuid ORDER BY ordinality), ARRAY[]::uuid[])
  INTO v_groups
  FROM jsonb_array_elements_text(v_params->'groups') WITH ORDINALITY AS item(value, ordinality);
  v_publication := public.approve_facebook_publication_v2(
    (v_params->>'product_id')::uuid,
    v_request.id,
    p_content,
    v_groups,
    (v_params->>'marketplace')::boolean,
    v_params->>'group_mode',
    p_repeat_of
  );
  UPDATE public.ai_action_requests
  SET status = 'confirmed', publication_id = v_publication,
      confirmed_params = v_params, confirmed_content = p_content,
      confirmed_repeat_of = p_repeat_of, confirmed_at = now(), updated_at = now()
  WHERE id = v_request.id;
  RETURN v_publication;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_ai_action(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_ai_action(uuid, jsonb, jsonb, uuid) TO authenticated;

BEGIN;

ALTER TABLE public.ai_actions_catalog
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'write',
  ADD COLUMN IF NOT EXISTS undoable boolean NOT NULL DEFAULT false;

UPDATE public.ai_actions_catalog
SET module = 'automation', kind = 'write', undoable = false
WHERE action_key = 'facebook.publish_product';

ALTER TABLE public.ai_actions_catalog
  ADD CONSTRAINT ai_actions_catalog_module_check
    CHECK (module IS NULL OR module IN ('stock', 'catalog', 'knowledge', 'automation')),
  ADD CONSTRAINT ai_actions_catalog_kind_check CHECK (kind IN ('read', 'write'));

INSERT INTO public.ai_actions_catalog (action_key, description, parameters_schema, requires_confirmation, module, kind, undoable)
VALUES
  ('product.update', 'Propone actualizar campos de un producto.', '{"type":"object"}'::jsonb, true, 'stock', 'write', true),
  ('product.create', 'Propone crear un producto nuevo.', '{"type":"object"}'::jsonb, true, 'stock', 'write', false),
  ('stock.adjust', 'Propone ajustar la existencia de un producto.', '{"type":"object"}'::jsonb, true, 'stock', 'write', true),
  ('price.bulk_update', 'Propone actualizar precios de hasta 200 productos.', '{"type":"object"}'::jsonb, true, 'stock', 'write', true),
  ('catalog.announcement', 'Propone cambiar la cinta de anuncios del catálogo.', '{"type":"object"}'::jsonb, true, 'catalog', 'write', true),
  ('knowledge.create_document', 'Propone crear un documento borrador en Conocimientos.', '{"type":"object"}'::jsonb, true, 'knowledge', 'write', false)
ON CONFLICT (action_key) DO UPDATE SET module = EXCLUDED.module, kind = EXCLUDED.kind, undoable = EXCLUDED.undoable;

ALTER TABLE public.ai_action_requests
  ADD COLUMN IF NOT EXISTS chat_id uuid,
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS result jsonb,
  ADD COLUMN IF NOT EXISTS undo jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS action_state text NOT NULL DEFAULT 'pending';

-- Keep the original status/check constraints intact for Facebook publication
-- requests. New chat actions use a separate lifecycle column so this migration
-- remains additive and does not weaken or replace the legacy constraints.
ALTER TABLE public.ai_action_requests
  ADD CONSTRAINT ai_action_requests_action_state_check
    CHECK (action_state IN ('pending', 'confirmed', 'cancelled', 'expired', 'failed', 'undone'));

ALTER TABLE public.ai_chat_messages
  ADD COLUMN IF NOT EXISTS action_request_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS timings_worker_id uuid;

CREATE INDEX IF NOT EXISTS ai_action_requests_chat_pending_idx
  ON public.ai_action_requests (user_id, chat_id, created_at DESC)
  WHERE status = 'pending' AND chat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ai_action_requests_require_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_module text;
BEGIN
  v_module := CASE WHEN NEW.action_key = 'facebook.publish_product' THEN 'automation' ELSE 'ai' END;
  PERFORM public.business_require_module(NEW.user_id, v_module);
  PERFORM public.business_require_active(NEW.user_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_requests_require_automation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_action_validate_parameters(p_action text, p_params jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_value numeric;
  v_ids jsonb;
BEGIN
  IF p_params IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Los parámetros de la acción no son válidos';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_params) LOOP
    IF NOT (CASE p_action
      WHEN 'product.update' THEN v_key IN ('product_id', 'nombre', 'descripcion', 'categoria', 'precio_venta')
      WHEN 'product.create' THEN v_key IN ('nombre', 'precio_venta', 'categoria', 'descripcion', 'stock_inicial')
      WHEN 'stock.adjust' THEN v_key IN ('product_id', 'cantidad', 'motivo')
      WHEN 'price.bulk_update' THEN v_key IN ('filtro', 'tipo', 'valor', 'redondeo')
      WHEN 'catalog.announcement' THEN v_key IN ('texto', 'activa')
      WHEN 'knowledge.create_document' THEN v_key IN ('titulo', 'contenido_markdown')
      ELSE false END) THEN
      RAISE EXCEPTION 'La acción contiene un parámetro no permitido';
    END IF;
  END LOOP;

  IF p_action = 'product.update' THEN
    IF NOT (p_params ? 'product_id') OR (p_params->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR NOT (p_params ?| ARRAY['nombre','descripcion','categoria','precio_venta']) THEN
      RAISE EXCEPTION 'La acción requiere product_id y al menos un campo para cambiar';
    END IF;
    IF p_params ? 'nombre' AND (jsonb_typeof(p_params->'nombre') <> 'string' OR char_length(btrim(p_params->>'nombre')) NOT BETWEEN 1 AND 160) THEN RAISE EXCEPTION 'El nombre debe tener entre 1 y 160 caracteres'; END IF;
    IF p_params ? 'descripcion' AND (jsonb_typeof(p_params->'descripcion') <> 'string' OR char_length(p_params->>'descripcion') > 2000) THEN RAISE EXCEPTION 'La descripción supera 2000 caracteres'; END IF;
    IF p_params ? 'categoria' AND (jsonb_typeof(p_params->'categoria') <> 'string' OR char_length(p_params->>'categoria') > 120) THEN RAISE EXCEPTION 'La categoría no es válida'; END IF;
    IF p_params ? 'precio_venta' AND (jsonb_typeof(p_params->'precio_venta') <> 'number' OR (p_params->>'precio_venta')::numeric <= 0) THEN RAISE EXCEPTION 'El precio tiene que ser mayor que cero'; END IF;
  ELSIF p_action = 'product.create' THEN
    IF NOT (p_params ? 'nombre' AND p_params ? 'precio_venta') OR jsonb_typeof(p_params->'nombre') <> 'string'
      OR char_length(btrim(p_params->>'nombre')) NOT BETWEEN 1 AND 160
      OR jsonb_typeof(p_params->'precio_venta') <> 'number' OR (p_params->>'precio_venta')::numeric <= 0 THEN
      RAISE EXCEPTION 'Ingresá nombre y precio de venta válido';
    END IF;
    IF p_params ? 'categoria' AND (jsonb_typeof(p_params->'categoria') <> 'string' OR char_length(p_params->>'categoria') > 120) THEN RAISE EXCEPTION 'La categoría no es válida'; END IF;
    IF p_params ? 'descripcion' AND (jsonb_typeof(p_params->'descripcion') <> 'string' OR char_length(p_params->>'descripcion') > 2000) THEN RAISE EXCEPTION 'La descripción supera 2000 caracteres'; END IF;
    IF p_params ? 'stock_inicial' AND (jsonb_typeof(p_params->'stock_inicial') <> 'number' OR (p_params->>'stock_inicial') !~ '^\d+$' OR (p_params->>'stock_inicial')::integer > 1000000) THEN RAISE EXCEPTION 'El stock inicial no es válido'; END IF;
  ELSIF p_action = 'stock.adjust' THEN
    IF NOT (p_params ? 'product_id' AND p_params ? 'cantidad' AND p_params ? 'motivo')
      OR (p_params->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_params->'cantidad') <> 'number' OR (p_params->>'cantidad') !~ '^-?\d+$'
      OR (p_params->>'cantidad')::integer = 0 OR abs((p_params->>'cantidad')::integer) > 1000000
      OR jsonb_typeof(p_params->'motivo') <> 'string' OR char_length(btrim(p_params->>'motivo')) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'La cantidad o el motivo del ajuste no son válidos';
    END IF;
  ELSIF p_action = 'price.bulk_update' THEN
    IF NOT (p_params ? 'filtro' AND p_params ? 'tipo' AND p_params ? 'valor') OR jsonb_typeof(p_params->'filtro') <> 'object'
      OR jsonb_typeof(p_params->'tipo') <> 'string' OR p_params->>'tipo' NOT IN ('porcentaje','monto')
      OR jsonb_typeof(p_params->'valor') <> 'number' THEN
      RAISE EXCEPTION 'El filtro de precios no es válido';
    END IF;
    IF ((p_params->'filtro') ? 'categoria') = ((p_params->'filtro') ? 'product_ids') THEN RAISE EXCEPTION 'Elegí una categoría o una lista de productos'; END IF;
    IF (p_params->'filtro') ? 'categoria' AND (jsonb_typeof(p_params->'filtro'->'categoria') <> 'string' OR char_length(btrim(p_params->'filtro'->>'categoria')) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'La categoría del filtro no es válida'; END IF;
    IF (p_params->'filtro') ? 'product_ids' THEN
      v_ids := p_params->'filtro'->'product_ids';
      IF jsonb_typeof(v_ids) <> 'array' OR jsonb_array_length(v_ids) NOT BETWEEN 1 AND 200
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ids) AS e(value) WHERE jsonb_typeof(e.value) <> 'string' OR e.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        OR jsonb_array_length(v_ids) <> (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_ids) AS id(value)) THEN
        RAISE EXCEPTION 'La lista de productos no es válida';
      END IF;
    END IF;
    v_value := (p_params->>'valor')::numeric;
    IF p_params->>'tipo' = 'porcentaje' AND abs(v_value) > 60 THEN RAISE EXCEPTION 'El cambio supera el 60 por ciento'; END IF;
    IF p_params->>'tipo' = 'monto' AND abs(v_value) > 1000000 THEN RAISE EXCEPTION 'El monto del cambio supera el límite permitido'; END IF;
    IF p_params ? 'redondeo' AND (jsonb_typeof(p_params->'redondeo') <> 'number' OR (p_params->>'redondeo') !~ '^\d+$' OR (p_params->>'redondeo')::integer NOT IN (1,10,50,100,500,1000)) THEN RAISE EXCEPTION 'El redondeo no es válido'; END IF;
  ELSIF p_action = 'catalog.announcement' THEN
    IF NOT (p_params ? 'texto' AND p_params ? 'activa') OR jsonb_typeof(p_params->'texto') <> 'string'
      OR char_length(p_params->>'texto') > 120 OR jsonb_typeof(p_params->'activa') <> 'boolean' THEN
      RAISE EXCEPTION 'El texto o estado de la cinta no son válidos';
    END IF;
  ELSIF p_action = 'knowledge.create_document' THEN
    IF NOT (p_params ? 'titulo' AND p_params ? 'contenido_markdown') OR jsonb_typeof(p_params->'titulo') <> 'string'
      OR char_length(btrim(p_params->>'titulo')) NOT BETWEEN 1 AND 160
      OR jsonb_typeof(p_params->'contenido_markdown') <> 'string'
      OR char_length(btrim(p_params->>'contenido_markdown')) NOT BETWEEN 1 AND 500000 THEN
      RAISE EXCEPTION 'El título y el contenido del documento son obligatorios';
    END IF;
  ELSE
    RAISE EXCEPTION 'La acción no está disponible';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_validate_parameters(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_action_preview(p_owner uuid, p_action_key text, p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_module text;
  v_product public.products%ROWTYPE;
  v_config public.catalog_config%ROWTYPE;
  v_presentation jsonb;
  v_before jsonb;
  v_after jsonb;
  v_examples jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_summary text;
  v_amount numeric;
  v_rounding integer := 1;
  v_product_ids uuid[];
  v_row record;
  v_owner_id uuid;
  v_fingerprint text;
BEGIN
  IF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.ai_actions_catalog WHERE action_key = p_action_key AND kind = 'write') THEN
    RAISE EXCEPTION 'La acción no está disponible';
  END IF;
  PERFORM public.ai_action_validate_parameters(p_action_key, p_params);
  SELECT module INTO v_module FROM public.ai_actions_catalog WHERE action_key = p_action_key;
  IF v_module IS NOT NULL AND NOT public.business_module_enabled(p_owner, CASE WHEN v_module = 'catalog' THEN 'ai' ELSE v_module END) THEN
    RAISE EXCEPTION 'El módulo necesario no está incluido en el plan';
  END IF;
  PERFORM public.business_require_active(p_owner);

  IF p_action_key = 'product.update' THEN
    SELECT * INTO v_product FROM public.products WHERE user_id = p_owner AND id = (p_params->>'product_id')::uuid;
    IF NOT FOUND OR COALESCE(v_product.catalog_only, false) THEN RAISE EXCEPTION 'Producto no encontrado o no editable'; END IF;
    v_before := '{}'::jsonb; v_after := '{}'::jsonb;
    IF p_params ? 'nombre' THEN v_before := v_before || jsonb_build_object('nombre', v_product.name); v_after := v_after || jsonb_build_object('nombre', btrim(p_params->>'nombre')); END IF;
    IF p_params ? 'descripcion' THEN v_before := v_before || jsonb_build_object('descripcion', v_product.description); v_after := v_after || jsonb_build_object('descripcion', p_params->>'descripcion'); END IF;
    IF p_params ? 'categoria' THEN v_before := v_before || jsonb_build_object('categoria', v_product.category); v_after := v_after || jsonb_build_object('categoria', btrim(p_params->>'categoria')); END IF;
    IF p_params ? 'precio_venta' THEN v_before := v_before || jsonb_build_object('precio_venta', v_product.sale_price); v_after := v_after || jsonb_build_object('precio_venta', (p_params->>'precio_venta')::numeric); END IF;
    v_count := 1; v_examples := jsonb_build_array(jsonb_build_object('producto', v_product.name, 'antes', v_before, 'despues', v_after));
    v_summary := 'Actualizar ' || v_product.name;
  ELSIF p_action_key = 'product.create' THEN
    SELECT id INTO v_owner_id FROM public.inventory_owners WHERE user_id = p_owner AND is_primary AND archived_at IS NULL;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'No se encontró el titular principal de mercadería'; END IF;
    v_before := NULL;
    v_after := jsonb_build_object('nombre', btrim(p_params->>'nombre'), 'categoria', COALESCE(btrim(p_params->>'categoria'), ''),
      'precio_venta', (p_params->>'precio_venta')::numeric, 'stock', COALESCE((p_params->>'stock_inicial')::integer, 0),
      'descripcion', COALESCE(p_params->>'descripcion', ''));
    v_count := 1; v_examples := jsonb_build_array(v_after); v_summary := 'Crear producto ' || btrim(p_params->>'nombre');
  ELSIF p_action_key = 'stock.adjust' THEN
    SELECT * INTO v_product FROM public.products WHERE user_id = p_owner AND id = (p_params->>'product_id')::uuid;
    IF NOT FOUND OR COALESCE(v_product.catalog_only, false) THEN RAISE EXCEPTION 'Producto no encontrado o sin stock propio'; END IF;
    IF COALESCE((SELECT holdings_enabled FROM public.inventory_operation_settings WHERE user_id = p_owner), false) THEN
      SELECT io.id INTO v_owner_id FROM public.inventory_owners io JOIN public.inventory_holdings h ON h.user_id = io.user_id AND h.inventory_owner_id = io.id
        WHERE h.user_id = p_owner AND h.product_id = v_product.id AND h.active AND io.id = v_product.inventory_owner_id LIMIT 1;
      IF v_owner_id IS NULL THEN RAISE EXCEPTION 'El producto no tiene una existencia principal activa'; END IF;
      SELECT stock INTO v_amount FROM public.inventory_holdings WHERE user_id = p_owner AND product_id = v_product.id AND inventory_owner_id = v_owner_id AND active;
    ELSE v_amount := v_product.stock; v_owner_id := v_product.inventory_owner_id; END IF;
    IF v_amount + (p_params->>'cantidad')::integer < 0 THEN RAISE EXCEPTION 'El ajuste dejaría stock negativo'; END IF;
    v_before := jsonb_build_object('stock', v_amount); v_after := jsonb_build_object('stock', v_amount + (p_params->>'cantidad')::integer);
    v_count := 1; v_examples := jsonb_build_array(jsonb_build_object('producto', v_product.name, 'antes', v_amount, 'despues', v_amount + (p_params->>'cantidad')::integer));
    v_summary := 'Ajustar stock de ' || v_product.name;
  ELSIF p_action_key = 'price.bulk_update' THEN
    v_amount := (p_params->>'valor')::numeric;
    v_rounding := COALESCE((p_params->>'redondeo')::integer, 1);
    v_product_ids := ARRAY[]::uuid[];
    IF (p_params->'filtro') ? 'product_ids' THEN
      SELECT array_agg(value::uuid) INTO v_product_ids FROM jsonb_array_elements_text(p_params->'filtro'->'product_ids') AS ids(value);
    ELSE
      SELECT array_agg(id) INTO v_product_ids FROM public.products WHERE user_id = p_owner AND category = p_params->'filtro'->>'categoria' AND NOT COALESCE(catalog_only,false);
    END IF;
    IF cardinality(v_product_ids) > 200 THEN RAISE EXCEPTION 'El cambio alcanza más de 200 productos'; END IF;
    SELECT count(*)::integer INTO v_count FROM public.products WHERE user_id = p_owner AND id = ANY(v_product_ids) AND NOT COALESCE(catalog_only,false);
    IF v_count = 0 THEN RAISE EXCEPTION 'No hay productos para actualizar'; END IF;
    IF cardinality(v_product_ids) <> v_count THEN RAISE EXCEPTION 'Uno o más productos no pertenecen al negocio o no son editables'; END IF;
    SELECT md5(COALESCE(string_agg(id::text || ':' || sale_price::text, ',' ORDER BY id),'')) INTO v_fingerprint
      FROM public.products WHERE user_id=p_owner AND id=ANY(v_product_ids) AND NOT COALESCE(catalog_only,false);
    v_before := jsonb_build_object('cantidad', v_count, 'fingerprint', v_fingerprint);
    v_after := jsonb_build_object('cantidad', v_count, 'tipo', p_params->>'tipo', 'valor', v_amount);
    FOR v_row IN SELECT id, name, sale_price FROM public.products WHERE user_id = p_owner AND id = ANY(v_product_ids) ORDER BY name LIMIT 5 LOOP
      DECLARE v_new numeric;
      BEGIN
        v_new := CASE p_params->>'tipo' WHEN 'porcentaje' THEN v_row.sale_price * (1 + v_amount / 100) ELSE v_row.sale_price + v_amount END;
        v_new := round(v_new / v_rounding) * v_rounding;
        IF v_new <= 0 THEN RAISE EXCEPTION 'El cambio deja un precio menor o igual a cero'; END IF;
        v_examples := v_examples || jsonb_build_array(jsonb_build_object('id', v_row.id, 'producto', v_row.name, 'antes', v_row.sale_price, 'despues', v_new));
      END;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.products p WHERE p.user_id = p_owner AND p.id = ANY(v_product_ids)
      AND round((CASE p_params->>'tipo' WHEN 'porcentaje' THEN p.sale_price * (1 + v_amount / 100) ELSE p.sale_price + v_amount END) / v_rounding) * v_rounding <= 0) THEN
      RAISE EXCEPTION 'El cambio deja un precio menor o igual a cero';
    END IF;
    v_summary := 'Actualizar el precio de ' || v_count || ' productos';
  ELSIF p_action_key = 'catalog.announcement' THEN
    SELECT * INTO v_config FROM public.catalog_config WHERE user_id = p_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la configuración del catálogo'; END IF;
    v_presentation := COALESCE(v_config.presentation, '{}'::jsonb);
    v_before := jsonb_build_object('texto', COALESCE(v_presentation #>> '{ambience,announcementText}', ''), 'activa', COALESCE(NULLIF(v_presentation #>> '{ambience,announcementText}', ''), '') <> '');
    v_after := jsonb_build_object('texto', CASE WHEN (p_params->>'activa')::boolean THEN p_params->>'texto' ELSE '' END, 'activa', (p_params->>'activa')::boolean);
    v_count := 1; v_examples := jsonb_build_array(v_after); v_summary := 'Cambiar la cinta de anuncios del catálogo';
  ELSIF p_action_key = 'knowledge.create_document' THEN
    v_before := NULL; v_after := jsonb_build_object('titulo', btrim(p_params->>'titulo'), 'contenido', left(p_params->>'contenido_markdown', 500));
    v_count := 1; v_examples := jsonb_build_array(v_after); v_summary := 'Crear borrador de Conocimientos: ' || btrim(p_params->>'titulo');
  END IF;

  RETURN jsonb_build_object('ok', true, 'preview_id', pg_catalog.gen_random_uuid(), 'resumen', v_summary,
    'antes', v_before, 'despues', v_after, 'cantidad', v_count, 'ejemplos', v_examples);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_preview(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_preview(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_action_propose(p_owner uuid, p_job_id uuid, p_chat_id uuid, p_action_key text, p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_request uuid;
  v_pending integer;
BEGIN
  PERFORM 1 FROM public.ai_jobs WHERE id = p_job_id AND user_id = p_owner AND chat_id = p_chat_id
    AND status = 'processing' AND provider = 'codex' AND cancel_requested_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La conversación ya no está activa';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_chat_id::text));
  SELECT count(*) INTO v_pending FROM public.ai_action_requests WHERE user_id = p_owner AND chat_id = p_chat_id AND action_key <> 'facebook.publish_product' AND action_state = 'pending' AND expires_at > now();
  IF v_pending >= 10 THEN RAISE EXCEPTION 'Este chat ya tiene diez propuestas pendientes'; END IF;
  v_preview := public.ai_action_preview(p_owner, p_action_key, p_params);
  INSERT INTO public.ai_action_requests(user_id, action_key, source, params, draft_content, chat_id, job_id, expires_at, action_state)
  VALUES (p_owner, p_action_key, 'ai-chat', p_params,
    jsonb_build_object('summary', v_preview->'resumen', 'before', v_preview->'antes', 'after', v_preview->'despues',
      'count', v_preview->'cantidad', 'samples', v_preview->'ejemplos'),
    p_chat_id, p_job_id, now() + interval '30 minutes', 'pending')
  RETURNING id INTO v_request;
  RETURN jsonb_build_object('request_id', v_request, 'summary', v_preview->'resumen', 'expires_at', now() + interval '30 minutes', 'estado', 'pendiente_de_confirmacion');
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_propose(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_propose(uuid, uuid, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_job_record_measurements(p_owner uuid, p_worker_id uuid, p_job_id uuid, p_measurements jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF p_measurements IS NULL OR jsonb_typeof(p_measurements) IS DISTINCT FROM 'object' OR octet_length(p_measurements::text) > 4096 THEN RETURN false; END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_measurements) LOOP
    IF v_key NOT IN ('created_to_claim_ms','worker_context_ms','claim_to_context_ready_ms','business_card_ms','memory_retrieval_including_embedding_ms','query_embedding_ms','chat_history_index_ms','knowledge_retrieval_ms','codex_start_elapsed_ms','codex_first_event_elapsed_ms','codex_start_to_first_event_ms','codex_first_event_to_final_ms','response_save_ms','claimed_to_saved_ms','created_to_saved_ms','prompt_chars','response_chars','model_id','reasoning_effort','chat_session','tool_calls') THEN RETURN false; END IF;
    IF v_key IN ('model_id','reasoning_effort','chat_session') THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR char_length(v_value #>> '{}') > 40 THEN RETURN false; END IF;
    ELSIF v_key = 'tool_calls' THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'array' OR jsonb_array_length(v_value) > 40
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_value) AS call(value)
          WHERE jsonb_typeof(call.value) <> 'object'
            OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(call.value) AS keys(key)) IS DISTINCT FROM ARRAY['duration_ms','name','ok','row_count']::text[]
            OR jsonb_typeof(call.value->'name') <> 'string'
            OR char_length(call.value->>'name') > 80
            OR jsonb_typeof(call.value->'duration_ms') <> 'number'
            OR (call.value->>'duration_ms') !~ '^\d+$'
            OR (call.value->>'duration_ms')::numeric > 100000000
            OR jsonb_typeof(call.value->'ok') <> 'boolean'
            OR (call.value->'row_count' IS NOT NULL AND jsonb_typeof(call.value->'row_count') <> 'null'
              AND (jsonb_typeof(call.value->'row_count') <> 'number' OR (call.value->>'row_count') !~ '^\d+$' OR (call.value->>'row_count')::integer > 1000000))) THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v_value) IS DISTINCT FROM 'number' OR (v_value #>> '{}') !~ '^\d+$' OR (v_value #>> '{}')::numeric > 100000000 THEN RETURN false;
    END IF;
  END LOOP;
  UPDATE public.ai_jobs SET timings = COALESCE(timings, '{}'::jsonb) || p_measurements
  WHERE id = p_job_id AND user_id = p_owner
    AND ((status = 'processing' AND worker_id = p_worker_id)
      OR (status = 'completed' AND timings_worker_id = p_worker_id));
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_job_record_measurements(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_job_record_measurements(uuid, uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_bridge_finish_chat_job_with_actions(
  p_owner uuid, p_worker_id uuid, p_job_id uuid, p_success boolean,
  p_output text DEFAULT NULL, p_error text DEFAULT NULL, p_session_id text DEFAULT NULL,
  p_action_request_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_chat uuid;
BEGIN
  IF COALESCE(cardinality(p_action_request_ids), 0) > 10
    OR cardinality(p_action_request_ids) <> (SELECT count(DISTINCT item) FROM unnest(COALESCE(p_action_request_ids, ARRAY[]::uuid[])) AS ids(item)) THEN
    RAISE EXCEPTION 'Referencias de propuestas inválidas';
  END IF;
  v_result := public.ai_bridge_finish_chat_job(p_owner, p_worker_id, p_job_id, p_success, p_output, p_error, p_session_id);
  IF p_success THEN
    UPDATE public.ai_jobs SET timings_worker_id = p_worker_id
      WHERE id = p_job_id AND user_id = p_owner AND status = 'completed';
  END IF;
  SELECT chat_id INTO v_chat FROM public.ai_jobs WHERE id = p_job_id AND user_id = p_owner AND status = 'completed';
  IF NOT p_success OR v_chat IS NULL THEN
    UPDATE public.ai_action_requests SET action_state='cancelled', error='El turno terminó sin completar la respuesta.', updated_at=now()
      WHERE user_id=p_owner AND job_id=p_job_id AND action_key <> 'facebook.publish_product' AND action_state='pending';
  ELSIF COALESCE(cardinality(p_action_request_ids), 0) > 0 THEN
    IF (SELECT count(*) FROM public.ai_action_requests WHERE user_id = p_owner AND chat_id = v_chat AND job_id = p_job_id AND id = ANY(p_action_request_ids)) <> cardinality(p_action_request_ids) THEN
      RAISE EXCEPTION 'Una propuesta no pertenece a este turno';
    END IF;
    UPDATE public.ai_chat_messages SET action_request_ids = p_action_request_ids
      WHERE user_id = p_owner AND job_id = p_job_id AND chat_id = v_chat AND role = 'assistant';
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_bridge_finish_chat_job_with_actions(uuid, uuid, uuid, boolean, text, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_bridge_finish_chat_job_with_actions(uuid, uuid, uuid, boolean, text, text, text, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_action_product_payload(p_product public.products)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_product.id, 'ownerUid', p_product.user_id, 'name', p_product.name,
    'categoryId', p_product.category_id, 'category', p_product.category,
    'purchasePrice', p_product.purchase_price, 'salePrice', p_product.sale_price,
    'stock', p_product.stock, 'minStock', p_product.min_stock,
    'imageUrl', p_product.image_url, 'images', COALESCE(to_jsonb(p_product.images), '[]'::jsonb),
    'showInCatalog', p_product.show_in_catalog, 'notes', p_product.notes,
    'description', p_product.description, 'barcode', p_product.barcode,
    'customFields', p_product.custom_fields, 'inventoryOwnerId', p_product.inventory_owner_id,
    'catalogOnly', p_product.catalog_only, 'catalogCost', p_product.catalog_cost,
    'createdAt', p_product.created_at
  );
$$;
REVOKE ALL ON FUNCTION public.ai_action_product_payload(public.products) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_action_cancel(p_request_id uuid)
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
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid=v_actor AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Solo el propietario puede descartar acciones'; END IF;
  SELECT * INTO v_request FROM public.ai_action_requests WHERE id=p_request_id AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND OR v_request.action_key='facebook.publish_product' THEN RAISE EXCEPTION 'No se encontró la propuesta'; END IF;
  IF v_request.action_state='cancelled' THEN RETURN true; END IF;
  IF v_request.action_state <> 'pending' THEN RAISE EXCEPTION 'La propuesta ya no está pendiente'; END IF;
  UPDATE public.ai_action_requests SET action_state='cancelled', updated_at=now() WHERE id=v_request.id AND user_id=v_actor;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_cancel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_cancel(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_action_confirm(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.ai_action_requests%ROWTYPE;
  v_preview jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_undo jsonb;
  v_product public.products%ROWTYPE;
  v_product_json jsonb;
  v_holdings jsonb;
  v_saved record;
  v_owner_id uuid;
  v_stock_enabled boolean;
  v_ids uuid[];
  v_row record;
  v_new_price numeric;
  v_command record;
  v_request_ids text[];
  v_doc public.knowledge_documents%ROWTYPE;
  v_product_id uuid;
  v_config public.catalog_config%ROWTYPE;
  v_presentation jsonb;
  v_expected_stock integer;
  v_command_key text;
  v_can_mark_failed boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid=v_actor AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Solo el propietario puede confirmar acciones'; END IF;
  SELECT * INTO v_request FROM public.ai_action_requests WHERE id=p_request_id AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la propuesta'; END IF;
  IF v_request.action_key = 'facebook.publish_product' THEN RAISE EXCEPTION 'Esta propuesta se confirma desde la revisión de Facebook'; END IF;
  IF v_request.action_state = 'confirmed' THEN RETURN COALESCE(v_request.result, '{}'::jsonb); END IF;
  IF v_request.action_state <> 'pending' THEN RAISE EXCEPTION 'La propuesta ya no está pendiente'; END IF;
  IF v_request.expires_at IS NULL OR v_request.expires_at <= now() THEN
    UPDATE public.ai_action_requests SET action_state='expired', updated_at=now() WHERE id=v_request.id AND user_id=v_actor;
    RETURN jsonb_build_object('ok',false,'expired',true,'message','La propuesta venció');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_actions_catalog WHERE action_key=v_request.action_key AND requires_confirmation) THEN RAISE EXCEPTION 'La acción ya no está disponible'; END IF;
  v_can_mark_failed := true;

  IF v_request.action_key = 'product.update' THEN
    v_product_id := (v_request.params->>'product_id')::uuid;
    v_command_key := 'ai-action:'||v_request.id::text||':'||v_product_id::text;
    PERFORM public.lock_inventory_commands(v_actor, ARRAY[v_command_key]);
    PERFORM public.lock_inventory_products(v_actor, ARRAY[v_product_id]);
    PERFORM 1 FROM public.products WHERE user_id=v_actor AND id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  ELSIF v_request.action_key = 'stock.adjust' THEN
    v_product_id := (v_request.params->>'product_id')::uuid;
    v_command_key := 'ai-action:'||v_request.id::text||':'||v_product_id::text;
    PERFORM public.lock_inventory_commands(v_actor, ARRAY[v_command_key]);
    PERFORM public.lock_inventory_products(v_actor, ARRAY[v_product_id]);
    SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
    IF COALESCE(v_stock_enabled,false) THEN
      PERFORM 1 FROM public.inventory_holdings WHERE user_id=v_actor AND product_id=v_product.id
        AND inventory_owner_id=v_product.inventory_owner_id AND active FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'El producto no tiene una existencia principal activa'; END IF;
    END IF;
  ELSIF v_request.action_key = 'price.bulk_update' THEN
    IF (v_request.params->'filtro') ? 'product_ids' THEN
      SELECT array_agg(value::uuid ORDER BY value::uuid) INTO v_ids FROM jsonb_array_elements_text(v_request.params->'filtro'->'product_ids') AS ids(value);
    ELSE
      SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.products WHERE user_id=v_actor
        AND category=v_request.params->'filtro'->>'categoria' AND NOT COALESCE(catalog_only,false);
    END IF;
    SELECT array_agg('ai-action:'||v_request.id::text||':'||id::text ORDER BY id) INTO v_request_ids FROM unnest(v_ids) AS id;
    PERFORM public.lock_inventory_commands(v_actor, v_request_ids);
    PERFORM public.lock_inventory_products(v_actor, v_ids);
    PERFORM 1 FROM public.products WHERE user_id=v_actor AND id=ANY(v_ids) ORDER BY id FOR UPDATE;
  ELSIF v_request.action_key = 'catalog.announcement' THEN
    PERFORM 1 FROM public.catalog_config WHERE user_id=v_actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la configuración del catálogo'; END IF;
  END IF;

  v_preview := public.ai_action_preview(v_actor, v_request.action_key, v_request.params);
  IF v_request.draft_content->'before' IS DISTINCT FROM v_preview->'antes'
    OR v_request.draft_content->'after' IS DISTINCT FROM v_preview->'despues'
    OR v_request.draft_content->'count' IS DISTINCT FROM v_preview->'cantidad' THEN
    RAISE EXCEPTION 'Los datos cambiaron, pedí la propuesta de nuevo';
  END IF;

  IF v_request.action_key IN ('product.update','product.create') THEN
    SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
    v_stock_enabled := COALESCE(v_stock_enabled,false);
    IF v_request.action_key = 'product.update' THEN
      SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=(v_request.params->>'product_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
      v_before := v_preview->'antes';
      v_product_json := public.ai_action_product_payload(v_product);
      IF v_request.params ? 'nombre' THEN v_product_json := jsonb_set(v_product_json,'{name}',to_jsonb(btrim(v_request.params->>'nombre'))); END IF;
      IF v_request.params ? 'descripcion' THEN v_product_json := jsonb_set(v_product_json,'{description}',to_jsonb(v_request.params->>'descripcion')); END IF;
      IF v_request.params ? 'categoria' THEN v_product_json := jsonb_set(v_product_json,'{category}',to_jsonb(btrim(v_request.params->>'categoria'))); END IF;
      IF v_request.params ? 'precio_venta' THEN v_product_json := jsonb_set(v_product_json,'{salePrice}',to_jsonb((v_request.params->>'precio_venta')::numeric)); END IF;
      IF v_stock_enabled THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('inventoryOwnerId',h.inventory_owner_id,'stock',h.stock,'purchaseCost',h.purchase_cost,'minStock',h.min_stock,'active',h.active) ORDER BY io.sort_order),'[]'::jsonb)
          INTO v_holdings FROM public.inventory_holdings h JOIN public.inventory_owners io ON io.user_id=h.user_id AND io.id=h.inventory_owner_id WHERE h.user_id=v_actor AND h.product_id=v_product.id;
      ELSE v_holdings := '[]'::jsonb; END IF;
      v_undo := jsonb_build_object('kind','product.update','product_id',v_product.id,'before',v_before,'after',v_preview->'despues');
    ELSE
      v_product_id := pg_catalog.gen_random_uuid();
      SELECT id INTO v_owner_id FROM public.inventory_owners WHERE user_id=v_actor AND is_primary AND archived_at IS NULL;
      v_product_json := jsonb_build_object('id',v_product_id,'ownerUid',v_actor,'name',btrim(v_request.params->>'nombre'),
        'categoryId','','category',COALESCE(btrim(v_request.params->>'categoria'),''),'purchasePrice',0,
        'salePrice',(v_request.params->>'precio_venta')::numeric,'stock',COALESCE((v_request.params->>'stock_inicial')::integer,0),
        'minStock',0,'images','[]'::jsonb,'showInCatalog',false,'description',COALESCE(v_request.params->>'descripcion',''),
        'inventoryOwnerId',v_owner_id,'catalogOnly',false,'createdAt',now());
      IF v_stock_enabled THEN
        v_holdings := jsonb_build_array(jsonb_build_object('inventoryOwnerId',v_owner_id,'stock',COALESCE((v_request.params->>'stock_inicial')::integer,0),'purchaseCost',0,'minStock',0,'active',true));
      ELSE v_holdings := '[]'::jsonb; END IF;
      v_undo := NULL;
    END IF;
    SELECT * INTO v_saved FROM public.save_product_with_holdings(v_product_json,v_holdings,'ai-action:'||v_request.id::text||':'||(v_product_json->>'id'));
    v_result := jsonb_build_object('ok',true,'product',v_saved.product,'summary',v_request.draft_content->'summary');
  ELSIF v_request.action_key = 'stock.adjust' THEN
    SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=(v_request.params->>'product_id')::uuid;
    SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
    v_stock_enabled := COALESCE(v_stock_enabled,false);
    SELECT * INTO v_command FROM public.adjust_product_stock(v_product.id,CASE WHEN v_stock_enabled THEN v_product.inventory_owner_id ELSE NULL END,
      CASE WHEN (v_request.params->>'cantidad')::integer > 0 THEN 'add' ELSE 'remove' END,
      abs((v_request.params->>'cantidad')::integer),v_request.params->>'motivo','ai-action:'||v_request.id::text||':'||v_product.id::text);
    v_expected_stock := v_command.resulting_stock;
    v_undo := jsonb_build_object('kind','stock.adjust','product_id',v_product.id,'inventory_owner_id',CASE WHEN v_stock_enabled THEN v_product.inventory_owner_id ELSE NULL END,
      'delta',(v_request.params->>'cantidad')::integer,'expected_stock',v_expected_stock);
    v_result := jsonb_build_object('ok',true,'stock',v_expected_stock,'summary',v_request.draft_content->'summary');
  ELSIF v_request.action_key = 'price.bulk_update' THEN
    IF (v_request.params->'filtro') ? 'product_ids' THEN
      SELECT array_agg(value::uuid) INTO v_ids FROM jsonb_array_elements_text(v_request.params->'filtro'->'product_ids') AS ids(value);
    ELSE
      SELECT array_agg(id) INTO v_ids FROM public.products WHERE user_id=v_actor AND category=v_request.params->'filtro'->>'categoria' AND NOT COALESCE(catalog_only,false);
    END IF;
    v_undo := jsonb_build_object('kind','price.bulk_update','products','[]'::jsonb);
    FOR v_product IN SELECT * FROM public.products WHERE user_id=v_actor AND id=ANY(v_ids) AND NOT COALESCE(catalog_only,false) ORDER BY id FOR UPDATE LOOP
      v_new_price := CASE v_request.params->>'tipo' WHEN 'porcentaje' THEN v_product.sale_price*(1+(v_request.params->>'valor')::numeric/100) ELSE v_product.sale_price+(v_request.params->>'valor')::numeric END;
      v_new_price := round(v_new_price/COALESCE((v_request.params->>'redondeo')::numeric,1))*COALESCE((v_request.params->>'redondeo')::numeric,1);
      v_product_json := jsonb_set(public.ai_action_product_payload(v_product),'{salePrice}',to_jsonb(v_new_price));
      SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
      v_stock_enabled := COALESCE(v_stock_enabled,false);
      IF v_stock_enabled THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('inventoryOwnerId',h.inventory_owner_id,'stock',h.stock,'purchaseCost',h.purchase_cost,'minStock',h.min_stock,'active',h.active) ORDER BY io.sort_order),'[]'::jsonb)
          INTO v_holdings FROM public.inventory_holdings h JOIN public.inventory_owners io ON io.user_id=h.user_id AND io.id=h.inventory_owner_id WHERE h.user_id=v_actor AND h.product_id=v_product.id;
      ELSE v_holdings:='[]'::jsonb; END IF;
      SELECT * INTO v_saved FROM public.save_product_with_holdings(v_product_json,v_holdings,'ai-action:'||v_request.id::text||':'||v_product.id::text);
      v_undo := jsonb_set(v_undo,'{products}',v_undo->'products'||jsonb_build_array(jsonb_build_object('id',v_product.id,'before',v_product.sale_price,'after',v_new_price)));
    END LOOP;
    v_result := jsonb_build_object('ok',true,'count',cardinality(v_ids),'summary',v_request.draft_content->'summary');
  ELSIF v_request.action_key = 'catalog.announcement' THEN
    SELECT * INTO v_config FROM public.catalog_config WHERE user_id=v_actor FOR UPDATE;
    v_undo := jsonb_build_object('kind','catalog.announcement','announcement_text',COALESCE(v_config.presentation #>> '{ambience,announcementText}', ''));
    v_presentation := COALESCE(v_config.presentation,'{}'::jsonb);
    v_presentation := jsonb_set(v_presentation,'{ambience}',COALESCE(v_presentation->'ambience','{}'::jsonb),true);
    v_presentation := jsonb_set(v_presentation,'{ambience,announcementText}',to_jsonb(CASE WHEN (v_request.params->>'activa')::boolean THEN v_request.params->>'texto' ELSE '' END),true);
    UPDATE public.catalog_config SET presentation=v_presentation WHERE user_id=v_actor;
    v_result := jsonb_build_object('ok',true,'summary',v_request.draft_content->'summary');
  ELSIF v_request.action_key = 'knowledge.create_document' THEN
    v_doc := public.knowledge_create_document('editor','editor',btrim(v_request.params->>'titulo'),'');
    PERFORM public.knowledge_save_draft(v_doc.id,jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',v_request.params->>'contenido_markdown'))))),0);
    v_result := jsonb_build_object('ok',true,'document_id',v_doc.id,'summary',v_request.draft_content->'summary');
    v_undo := NULL;
  ELSE
    RAISE EXCEPTION 'La acción no está disponible';
  END IF;

  UPDATE public.ai_action_requests SET action_state='confirmed',executed_at=now(),updated_at=now(),result=v_result,undo=v_undo,error=NULL
    WHERE id=v_request.id AND user_id=v_actor;
  INSERT INTO public.audit_events(user_id,actor_uid,action,entity_type,entity_id,metadata)
    VALUES (v_actor,v_actor,'ai_action_confirmed','ai_action_request',v_request.id::text,jsonb_build_object('action_key',v_request.action_key,'summary',v_request.draft_content->'summary'));
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  IF NOT v_can_mark_failed THEN RAISE; END IF;
  UPDATE public.ai_action_requests SET action_state='failed', error='No se pudo aplicar la propuesta. Revisá si los datos cambiaron y creá una nueva propuesta.', updated_at=now()
    WHERE id=p_request_id AND user_id=v_actor AND action_key <> 'facebook.publish_product' AND action_state='pending';
  RETURN jsonb_build_object('ok',false,'error','No se pudo aplicar la propuesta. Revisá si los datos cambiaron y creá una nueva propuesta.');
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_confirm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_confirm(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_action_undo(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.ai_action_requests%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_payload jsonb;
  v_holdings jsonb;
  v_stock_enabled boolean;
  v_entry jsonb;
  v_saved record;
  v_restored jsonb;
  v_command record;
  v_config public.catalog_config%ROWTYPE;
  v_product_id uuid;
  v_product_ids uuid[];
  v_command_keys text[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid=v_actor AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Solo el propietario puede deshacer acciones'; END IF;
  SELECT * INTO v_request FROM public.ai_action_requests WHERE id=p_request_id AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND OR v_request.action_state <> 'confirmed' THEN RAISE EXCEPTION 'La acción no se puede deshacer'; END IF;
  IF v_request.executed_at IS NULL OR v_request.executed_at < now()-interval '24 hours' OR NOT COALESCE((SELECT undoable FROM public.ai_actions_catalog WHERE action_key=v_request.action_key),false) THEN RAISE EXCEPTION 'La acción ya no se puede deshacer'; END IF;
  PERFORM public.business_require_active(v_actor);
  PERFORM public.business_require_module(v_actor, 'ai');
  IF v_request.undo->>'kind' = 'product.update' THEN
    v_product_id := (v_request.undo->>'product_id')::uuid;
    PERFORM public.lock_inventory_commands(v_actor, ARRAY['ai-action-undo:'||v_request.id::text]);
    PERFORM public.lock_inventory_products(v_actor, ARRAY[v_product_id]);
    SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El producto ya no está disponible'; END IF;
    IF v_request.undo->'after'->>'nombre' IS NOT NULL AND v_product.name IS DISTINCT FROM v_request.undo->'after'->>'nombre' THEN RAISE EXCEPTION 'El producto cambió desde la confirmación'; END IF;
    IF v_request.undo->'after'->>'descripcion' IS NOT NULL AND v_product.description IS DISTINCT FROM v_request.undo->'after'->>'descripcion' THEN RAISE EXCEPTION 'El producto cambió desde la confirmación'; END IF;
    IF v_request.undo->'after'->>'categoria' IS NOT NULL AND v_product.category IS DISTINCT FROM v_request.undo->'after'->>'categoria' THEN RAISE EXCEPTION 'El producto cambió desde la confirmación'; END IF;
    IF v_request.undo->'after'->>'precio_venta' IS NOT NULL AND v_product.sale_price IS DISTINCT FROM (v_request.undo->'after'->>'precio_venta')::numeric THEN RAISE EXCEPTION 'El producto cambió desde la confirmación'; END IF;
    v_payload := public.ai_action_product_payload(v_product);
    IF v_request.undo->'before' ? 'nombre' THEN v_payload:=jsonb_set(v_payload,'{name}',v_request.undo->'before'->'nombre'); END IF;
    IF v_request.undo->'before' ? 'descripcion' THEN v_payload:=jsonb_set(v_payload,'{description}',v_request.undo->'before'->'descripcion'); END IF;
    IF v_request.undo->'before' ? 'categoria' THEN v_payload:=jsonb_set(v_payload,'{category}',v_request.undo->'before'->'categoria'); END IF;
    IF v_request.undo->'before' ? 'precio_venta' THEN v_payload:=jsonb_set(v_payload,'{salePrice}',v_request.undo->'before'->'precio_venta'); END IF;
    SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
    IF COALESCE(v_stock_enabled,false) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('inventoryOwnerId',h.inventory_owner_id,'stock',h.stock,'purchaseCost',h.purchase_cost,'minStock',h.min_stock,'active',h.active) ORDER BY io.sort_order),'[]'::jsonb)
        INTO v_holdings FROM public.inventory_holdings h JOIN public.inventory_owners io ON io.user_id=h.user_id AND io.id=h.inventory_owner_id WHERE h.user_id=v_actor AND h.product_id=v_product.id;
    ELSE v_holdings:='[]'::jsonb; END IF;
    SELECT * INTO v_saved FROM public.save_product_with_holdings(v_payload,v_holdings,'ai-action-undo:'||v_request.id::text);
  ELSIF v_request.undo->>'kind' = 'stock.adjust' THEN
    v_product_id := (v_request.undo->>'product_id')::uuid;
    PERFORM public.lock_inventory_commands(v_actor, ARRAY['ai-action-undo:'||v_request.id::text]);
    PERFORM public.lock_inventory_products(v_actor, ARRAY[v_product_id]);
    SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El producto ya no está disponible'; END IF;
    IF NULLIF(v_request.undo->>'inventory_owner_id','') IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_holdings WHERE user_id=v_actor AND product_id=v_product.id
        AND inventory_owner_id=(v_request.undo->>'inventory_owner_id')::uuid AND active FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'La existencia ya no está disponible'; END IF;
    END IF;
    IF NULLIF(v_request.undo->>'inventory_owner_id','') IS NULL THEN
      IF v_product.stock <> (v_request.undo->>'expected_stock')::integer THEN RAISE EXCEPTION 'El stock cambió desde la confirmación'; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.inventory_holdings WHERE user_id=v_actor AND product_id=v_product.id
      AND inventory_owner_id=(v_request.undo->>'inventory_owner_id')::uuid AND active
      AND stock=(v_request.undo->>'expected_stock')::integer) THEN
      RAISE EXCEPTION 'El stock cambió desde la confirmación';
    END IF;
    SELECT * INTO v_command FROM public.adjust_product_stock(v_product.id,NULLIF(v_request.undo->>'inventory_owner_id','')::uuid,
      CASE WHEN (v_request.undo->>'delta')::integer > 0 THEN 'remove' ELSE 'add' END,
      abs((v_request.undo->>'delta')::integer),'Deshacer ajuste de IA','ai-action-undo:'||v_request.id::text);
  ELSIF v_request.undo->>'kind' = 'price.bulk_update' THEN
    SELECT array_agg((item->>'id')::uuid ORDER BY (item->>'id')::uuid) INTO v_product_ids
      FROM jsonb_array_elements(v_request.undo->'products') AS products(item);
    SELECT array_agg('ai-action-undo:'||v_request.id::text||':'||product_id::text ORDER BY product_id)
      INTO v_command_keys FROM unnest(v_product_ids) AS ids(product_id);
    PERFORM public.lock_inventory_commands(v_actor, v_command_keys);
    PERFORM public.lock_inventory_products(v_actor, v_product_ids);
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_request.undo->'products') LOOP
      SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=(v_entry->>'id')::uuid FOR UPDATE;
      IF NOT FOUND OR v_product.sale_price IS DISTINCT FROM (v_entry->>'after')::numeric THEN RAISE EXCEPTION 'Un precio cambió desde la confirmación'; END IF;
      v_payload:=jsonb_set(public.ai_action_product_payload(v_product),'{salePrice}',v_entry->'before');
      SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
      IF COALESCE(v_stock_enabled,false) THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('inventoryOwnerId',h.inventory_owner_id,'stock',h.stock,'purchaseCost',h.purchase_cost,'minStock',h.min_stock,'active',h.active) ORDER BY io.sort_order),'[]'::jsonb)
          INTO v_holdings FROM public.inventory_holdings h JOIN public.inventory_owners io ON io.user_id=h.user_id AND io.id=h.inventory_owner_id WHERE h.user_id=v_actor AND h.product_id=v_product.id;
      ELSE v_holdings:='[]'::jsonb; END IF;
      SELECT * INTO v_saved FROM public.save_product_with_holdings(v_payload,v_holdings,'ai-action-undo:'||v_request.id::text||':'||v_product.id::text);
    END LOOP;
  ELSIF v_request.undo->>'kind' = 'catalog.announcement' THEN
    SELECT * INTO v_config FROM public.catalog_config WHERE user_id=v_actor FOR UPDATE;
    IF v_config.presentation #>> '{ambience,announcementText}' IS DISTINCT FROM v_request.draft_content->'after'->>'texto' THEN RAISE EXCEPTION 'La cinta cambió desde la confirmación'; END IF;
    v_payload := COALESCE(v_config.presentation,'{}'::jsonb);
    v_payload := jsonb_set(v_payload,'{ambience}',COALESCE(v_payload->'ambience','{}'::jsonb),true);
    v_payload := jsonb_set(v_payload,'{ambience,announcementText}',to_jsonb(v_request.undo->>'announcement_text'),true);
    UPDATE public.catalog_config SET presentation=v_payload WHERE user_id=v_actor;
  ELSE RAISE EXCEPTION 'Esta acción no tiene deshacer disponible';
  END IF;
  v_restored:=jsonb_build_object('ok',true,'undone',true);
  UPDATE public.ai_action_requests SET action_state='undone',updated_at=now(),result=v_request.result||jsonb_build_object('undo_result',v_restored) WHERE id=v_request.id AND user_id=v_actor;
  INSERT INTO public.audit_events(user_id,actor_uid,action,entity_type,entity_id,metadata)
    VALUES (v_actor,v_actor,'ai_action_undone','ai_action_request',v_request.id::text,jsonb_build_object('action_key',v_request.action_key));
  RETURN v_restored;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_undo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_undo(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

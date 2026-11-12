-- I53 Etapa 4: business-safe errors, explicit knowledge sources, and relevant memory retrieval.
BEGIN;
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
  v_allowed text[];
  v_error_message text;
BEGIN
  IF p_params IS NULL OR jsonb_typeof(p_params) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Los parámetros de la acción no son válidos';
  END IF;
  v_allowed := CASE p_action
    WHEN 'product.update' THEN ARRAY['product_id','nombre','descripcion','categoria','precio_venta','mostrar_en_catalogo']::text[]
    WHEN 'product.create' THEN ARRAY['nombre','precio_venta','categoria','descripcion','stock_inicial','mostrar_en_catalogo']::text[]
    WHEN 'stock.adjust' THEN ARRAY['product_id','cantidad','motivo']::text[]
    WHEN 'price.bulk_update' THEN ARRAY['filtro','tipo','valor','redondeo']::text[]
    WHEN 'catalog.announcement' THEN ARRAY['texto','activa']::text[]
    WHEN 'knowledge.create_document' THEN ARRAY['titulo','contenido_markdown']::text[]
    ELSE ARRAY[]::text[] END;
  FOR v_key IN SELECT jsonb_object_keys(p_params) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'El parámetro "%" no está permitido para %. Parámetros permitidos: %.',
        v_key, p_action, COALESCE(array_to_string(v_allowed, ', '), 'ninguno');
    END IF;
  END LOOP;

  IF p_action = 'product.update' THEN
    IF NOT (p_params ? 'product_id') OR (p_params->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR NOT (p_params ?| ARRAY['nombre','descripcion','categoria','precio_venta','mostrar_en_catalogo']) THEN
      RAISE EXCEPTION 'La acción requiere product_id y al menos un campo para cambiar';
    END IF;
    IF p_params ? 'nombre' AND (jsonb_typeof(p_params->'nombre') <> 'string' OR char_length(btrim(p_params->>'nombre')) NOT BETWEEN 1 AND 160) THEN RAISE EXCEPTION 'El nombre debe tener entre 1 y 160 caracteres'; END IF;
    IF p_params ? 'descripcion' AND (jsonb_typeof(p_params->'descripcion') <> 'string' OR char_length(p_params->>'descripcion') > 2000) THEN RAISE EXCEPTION 'La descripción supera 2000 caracteres'; END IF;
    IF p_params ? 'categoria' AND (jsonb_typeof(p_params->'categoria') <> 'string' OR char_length(p_params->>'categoria') > 120) THEN RAISE EXCEPTION 'La categoría no es válida'; END IF;
    IF p_params ? 'precio_venta' AND (jsonb_typeof(p_params->'precio_venta') <> 'number' OR (p_params->>'precio_venta')::numeric <= 0) THEN RAISE EXCEPTION 'El precio tiene que ser mayor que cero'; END IF;
    IF p_params ? 'mostrar_en_catalogo' AND jsonb_typeof(p_params->'mostrar_en_catalogo') <> 'boolean' THEN RAISE EXCEPTION 'Mostrar en catálogo debe ser Sí o No'; END IF;
  ELSIF p_action = 'product.create' THEN
    IF NOT (p_params ? 'nombre' AND p_params ? 'precio_venta') OR jsonb_typeof(p_params->'nombre') <> 'string'
      OR char_length(btrim(p_params->>'nombre')) NOT BETWEEN 1 AND 160
      OR jsonb_typeof(p_params->'precio_venta') <> 'number' OR (p_params->>'precio_venta')::numeric <= 0 THEN
      RAISE EXCEPTION 'Ingresá nombre y precio de venta válido';
    END IF;
    IF p_params ? 'categoria' AND (jsonb_typeof(p_params->'categoria') <> 'string' OR char_length(p_params->>'categoria') > 120) THEN RAISE EXCEPTION 'La categoría no es válida'; END IF;
    IF p_params ? 'descripcion' AND (jsonb_typeof(p_params->'descripcion') <> 'string' OR char_length(p_params->>'descripcion') > 2000) THEN RAISE EXCEPTION 'La descripción supera 2000 caracteres'; END IF;
    IF p_params ? 'stock_inicial' AND (jsonb_typeof(p_params->'stock_inicial') <> 'number' OR (p_params->>'stock_inicial') !~ '^\d+$' OR (p_params->>'stock_inicial')::integer > 1000000) THEN RAISE EXCEPTION 'El stock inicial no es válido'; END IF;
    IF p_params ? 'mostrar_en_catalogo' AND jsonb_typeof(p_params->'mostrar_en_catalogo') <> 'boolean' THEN RAISE EXCEPTION 'Mostrar en catálogo debe ser Sí o No'; END IF;
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
    FOR v_key IN SELECT jsonb_object_keys(p_params->'filtro') LOOP
      IF v_key NOT IN ('categoria','product_ids') THEN
        RAISE EXCEPTION 'El parámetro "%" no está permitido para price.bulk_update.filtro. Parámetros permitidos: categoria, product_ids.', v_key;
      END IF;
    END LOOP;
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
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  RAISE EXCEPTION USING ERRCODE = 'AI001', MESSAGE = v_error_message;
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
  v_error_message text;
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
    IF p_params ? 'mostrar_en_catalogo' THEN v_before := v_before || jsonb_build_object('mostrar_en_catalogo', v_product.show_in_catalog); v_after := v_after || jsonb_build_object('mostrar_en_catalogo', (p_params->>'mostrar_en_catalogo')::boolean); END IF;
    v_count := 1; v_examples := jsonb_build_array(jsonb_build_object('producto', v_product.name, 'antes', v_before, 'despues', v_after));
    v_summary := 'Actualizar ' || v_product.name;
  ELSIF p_action_key = 'product.create' THEN
    SELECT id INTO v_owner_id FROM public.inventory_owners WHERE user_id = p_owner AND is_primary AND archived_at IS NULL;
    IF v_owner_id IS NULL THEN RAISE EXCEPTION 'No se encontró el titular principal de mercadería'; END IF;
    v_before := NULL;
    v_after := jsonb_build_object('nombre', btrim(p_params->>'nombre'), 'categoria', COALESCE(btrim(p_params->>'categoria'), ''),
      'precio_venta', (p_params->>'precio_venta')::numeric, 'stock', COALESCE((p_params->>'stock_inicial')::integer, 0),
      'descripcion', COALESCE(p_params->>'descripcion', ''),
      'mostrar_en_catalogo', COALESCE((p_params->>'mostrar_en_catalogo')::boolean, true));
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
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  RAISE EXCEPTION USING ERRCODE = 'AI001', MESSAGE = v_error_message;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_preview(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_preview(uuid, text, jsonb) TO service_role;
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
      IF v_request.params ? 'mostrar_en_catalogo' THEN v_product_json := jsonb_set(v_product_json,'{showInCatalog}',v_request.params->'mostrar_en_catalogo'); END IF;
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
        'minStock',0,'images','[]'::jsonb,'showInCatalog',COALESCE((v_request.params->>'mostrar_en_catalogo')::boolean,true),'description',COALESCE(v_request.params->>'descripcion',''),
        'inventoryOwnerId',v_owner_id,'catalogOnly',false,'createdAt',now());
      IF v_stock_enabled THEN
        v_holdings := jsonb_build_array(jsonb_build_object('inventoryOwnerId',v_owner_id,'stock',COALESCE((v_request.params->>'stock_inicial')::integer,0),'purchaseCost',0,'minStock',0,'active',true));
      ELSE v_holdings := '[]'::jsonb; END IF;
    END IF;
    SELECT * INTO v_saved FROM public.save_product_with_holdings(v_product_json,v_holdings,'ai-action:'||v_request.id::text||':'||(v_product_json->>'id'));
    IF v_request.action_key = 'product.create' THEN
      v_undo := jsonb_build_object('kind','product.create','product_id',v_product_id,
        'after', jsonb_build_object('nombre',btrim(v_request.params->>'nombre'),
          'descripcion',COALESCE(v_request.params->>'descripcion',''),
          'categoria',COALESCE(btrim(v_request.params->>'categoria'),''),
          'precio_venta',(v_request.params->>'precio_venta')::numeric,
          'stock',COALESCE((v_request.params->>'stock_inicial')::integer,0),
          'mostrar_en_catalogo',COALESCE((v_request.params->>'mostrar_en_catalogo')::boolean,true)));
    END IF;
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
  v_fk record;
  v_referenced boolean;
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
    IF v_request.undo->'after' ? 'mostrar_en_catalogo' AND v_product.show_in_catalog IS DISTINCT FROM (v_request.undo->'after'->>'mostrar_en_catalogo')::boolean THEN RAISE EXCEPTION 'El producto cambió desde la confirmación'; END IF;
    v_payload := public.ai_action_product_payload(v_product);
    IF v_request.undo->'before' ? 'nombre' THEN v_payload:=jsonb_set(v_payload,'{name}',v_request.undo->'before'->'nombre'); END IF;
    IF v_request.undo->'before' ? 'descripcion' THEN v_payload:=jsonb_set(v_payload,'{description}',v_request.undo->'before'->'descripcion'); END IF;
    IF v_request.undo->'before' ? 'categoria' THEN v_payload:=jsonb_set(v_payload,'{category}',v_request.undo->'before'->'categoria'); END IF;
    IF v_request.undo->'before' ? 'precio_venta' THEN v_payload:=jsonb_set(v_payload,'{salePrice}',v_request.undo->'before'->'precio_venta'); END IF;
    IF v_request.undo->'before' ? 'mostrar_en_catalogo' THEN v_payload:=jsonb_set(v_payload,'{showInCatalog}',v_request.undo->'before'->'mostrar_en_catalogo'); END IF;
    SELECT holdings_enabled INTO v_stock_enabled FROM public.inventory_operation_settings WHERE user_id=v_actor;
    IF COALESCE(v_stock_enabled,false) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('inventoryOwnerId',h.inventory_owner_id,'stock',h.stock,'purchaseCost',h.purchase_cost,'minStock',h.min_stock,'active',h.active) ORDER BY io.sort_order),'[]'::jsonb)
        INTO v_holdings FROM public.inventory_holdings h JOIN public.inventory_owners io ON io.user_id=h.user_id AND io.id=h.inventory_owner_id WHERE h.user_id=v_actor AND h.product_id=v_product.id;
    ELSE v_holdings:='[]'::jsonb; END IF;
    SELECT * INTO v_saved FROM public.save_product_with_holdings(v_payload,v_holdings,'ai-action-undo:'||v_request.id::text);
  ELSIF v_request.undo->>'kind' = 'product.create' THEN
    v_product_id := (v_request.undo->>'product_id')::uuid;
    PERFORM public.lock_inventory_commands(v_actor, ARRAY['ai-action-undo:'||v_request.id::text]);
    PERFORM public.lock_inventory_products(v_actor, ARRAY[v_product_id]);
    SELECT * INTO v_product FROM public.products WHERE user_id=v_actor AND id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El producto ya no está disponible'; END IF;
    IF v_product.name IS DISTINCT FROM v_request.undo->'after'->>'nombre'
      OR v_product.description IS DISTINCT FROM v_request.undo->'after'->>'descripcion'
      OR v_product.category IS DISTINCT FROM v_request.undo->'after'->>'categoria'
      OR v_product.sale_price IS DISTINCT FROM (v_request.undo->'after'->>'precio_venta')::numeric
      OR v_product.stock IS DISTINCT FROM (v_request.undo->'after'->>'stock')::integer
      OR v_product.show_in_catalog IS DISTINCT FROM (v_request.undo->'after'->>'mostrar_en_catalogo')::boolean THEN
      RAISE EXCEPTION 'El producto cambió desde la confirmación';
    END IF;
    FOR v_fk IN
      SELECT child_ns.nspname AS schema_name, child.relname AS table_name, child_att.attname AS column_name
      FROM pg_catalog.pg_constraint fk
      JOIN pg_catalog.pg_class child ON child.oid=fk.conrelid
      JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid=child.relnamespace
      JOIN LATERAL pg_catalog.unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, ord) ON true
      JOIN LATERAL pg_catalog.unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, ord) ON parent_key.ord=child_key.ord
      JOIN pg_catalog.pg_attribute child_att ON child_att.attrelid=child.oid AND child_att.attnum=child_key.attnum
      JOIN pg_catalog.pg_attribute parent_att ON parent_att.attrelid=fk.confrelid AND parent_att.attnum=parent_key.attnum
      WHERE fk.contype='f' AND fk.confrelid='public.products'::regclass AND parent_att.attname='id'
        AND NOT (child_ns.nspname='public' AND child.relname='inventory_holdings')
    LOOP
      EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
        v_fk.schema_name, v_fk.table_name, v_fk.column_name) INTO v_referenced USING v_product_id;
      IF v_referenced THEN RAISE EXCEPTION 'El producto ya se usa en otra parte y no se puede deshacer'; END IF;
    END LOOP;
    DELETE FROM public.products WHERE id=v_product_id AND user_id=v_actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'El producto ya no está disponible'; END IF;
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

UPDATE public.ai_actions_catalog SET undoable=true WHERE action_key='product.create';

CREATE OR REPLACE FUNCTION public.ai_memory_retrieve_relevant(
  p_owner uuid, p_worker uuid, p_job_id uuid, p_payload jsonb, p_include_summaries boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_settings public.ai_memory_settings%ROWTYPE;
  v_embedding extensions.vector(384);
  v_memories jsonb := '[]'::jsonb;
  v_turn_count integer := 0;
  v_message_count integer := 0;
  v_mode text := 'auto';
  v_include_summaries boolean := false;
  v_pinned_count integer := 0;
  v_item jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_job_id IS NULL
    OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'embedding') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload->'embedding') <> 384
    OR jsonb_typeof(p_payload->'query') IS DISTINCT FROM 'string'
    OR char_length(p_payload->>'query') > 8000 THEN
    RAISE EXCEPTION 'Solicitud de recuperación de memoria inválida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_bridge_devices WHERE id=p_worker AND user_id=p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  SELECT * INTO v_job FROM public.ai_jobs WHERE id=p_job_id AND user_id=p_owner;
  IF NOT FOUND OR v_job.status <> 'processing' OR v_job.worker_id <> p_worker OR v_job.task_type <> 'text_generation' THEN
    RAISE EXCEPTION 'La tarea no está reservada por este worker';
  END IF;
  SELECT * INTO v_settings FROM public.ai_memory_settings WHERE user_id=p_owner;
  IF FOUND THEN v_mode := v_settings.mode; END IF;
  IF v_mode='off' THEN
    RETURN jsonb_build_object('enabled',false,'memories','[]'::jsonb,'user_turn_count',0,'message_count',0,
      'mode',v_mode,'top_k',3,'include_summaries',false);
  END IF;
  v_include_summaries := COALESCE(p_include_summaries,false) AND COALESCE(v_settings.include_summaries,false);
  v_embedding := replace((p_payload->'embedding')::text,' ','')::extensions.vector;
  IF v_job.chat_id IS NOT NULL THEN
    INSERT INTO public.ai_memory_job_claims(user_id,job_id,worker_id)
      VALUES(p_owner,p_job_id,p_worker)
      ON CONFLICT(user_id,job_id) DO UPDATE SET worker_id=EXCLUDED.worker_id,expires_at=now()+interval '30 minutes';
    DELETE FROM public.ai_memory_job_claims WHERE user_id=p_owner AND expires_at<=now();
    SELECT count(*) FILTER (WHERE role='user'),count(*) INTO v_turn_count,v_message_count
      FROM public.ai_chat_messages WHERE user_id=p_owner AND chat_id=v_job.chat_id;
  END IF;

  SELECT count(*)::integer INTO v_pinned_count FROM public.ai_memories
    WHERE user_id=p_owner AND status='active' AND kind='preference' AND pinned;
  WITH pinned AS (
    SELECT memory.*, NULL::double precision AS similarity, 0 AS sort_order
    FROM public.ai_memories memory
    WHERE memory.user_id=p_owner AND memory.status='active' AND memory.kind='preference' AND memory.pinned
    ORDER BY memory.updated_at DESC,memory.id
  ), relevant AS (
    SELECT memory.*,
      (1-(memory.embedding OPERATOR(extensions.<=>) v_embedding))::double precision AS similarity,
      CASE WHEN memory.kind='fact' THEN 1 ELSE 2 END AS sort_order
    FROM public.ai_memories memory
    WHERE memory.user_id=p_owner AND memory.status='active' AND memory.kind IN ('fact','summary')
      AND memory.embedding IS NOT NULL
      AND (memory.kind='fact' OR (v_include_summaries AND memory.source_chat_id IS DISTINCT FROM v_job.chat_id))
      AND (1-(memory.embedding OPERATOR(extensions.<=>) v_embedding)) >= 0.78
    ORDER BY memory.embedding OPERATOR(extensions.<=>) v_embedding,memory.id
    LIMIT GREATEST(3-v_pinned_count,0)
  ), selected AS (
    SELECT * FROM pinned UNION ALL SELECT * FROM relevant
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'content',content,'pinned',pinned,'source_chat_id',source_chat_id,
    'source_job_id',source_job_id,'similarity',similarity,'use_count',use_count,'created_at',created_at
  ) ORDER BY sort_order,similarity DESC NULLS LAST,created_at DESC),'[]'::jsonb)
  INTO v_memories FROM selected;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_memories) LOOP
    UPDATE public.ai_memories SET use_count=use_count+1,last_used_at=now()
      WHERE id=(v_item->>'id')::uuid AND user_id=p_owner;
    INSERT INTO public.ai_memory_events(user_id,memory_id,action,source_job_id)
      VALUES(p_owner,(v_item->>'id')::uuid,'used',p_job_id);
  END LOOP;
  RETURN jsonb_build_object('enabled',true,'memories',v_memories,'user_turn_count',v_turn_count,
    'message_count',v_message_count,'mode',v_mode,'top_k',3,'include_summaries',v_include_summaries);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_memory_retrieve_relevant(uuid, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_memory_retrieve_relevant(uuid, uuid, uuid, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_tool_knowledge_search(
  p_owner uuid,p_worker uuid,p_job_id uuid,p_args jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings public.knowledge_settings%ROWTYPE;
  v_embedding extensions.vector(384);
  v_sources jsonb := '[]'::jsonb;
  v_top integer := 6;
  v_min double precision := 0.75;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_job_id IS NULL OR jsonb_typeof(p_args) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_args->'consulta') IS DISTINCT FROM 'string'
    OR char_length(btrim(p_args->>'consulta')) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'La consulta de Conocimientos no es válida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_bridge_devices WHERE id=p_worker AND user_id=p_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Computadora desvinculada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_jobs WHERE id=p_job_id AND user_id=p_owner AND worker_id=p_worker
    AND status='processing' AND task_type='text_generation' AND chat_id IS NOT NULL) THEN
    RAISE EXCEPTION 'La tarea no está reservada por este worker';
  END IF;
  IF NOT public.business_module_enabled(p_owner,'knowledge') THEN RAISE EXCEPTION 'El módulo Conocimientos no está incluido en el plan'; END IF;
  SELECT * INTO v_settings FROM public.knowledge_settings WHERE user_id=p_owner;
  IF FOUND THEN
    IF NOT v_settings.chat_retrieval_enabled THEN RETURN jsonb_build_object('items','[]'::jsonb); END IF;
    v_top := v_settings.top_k;
    v_min := GREATEST(v_settings.min_similarity,0.75);
  END IF;
  IF jsonb_typeof(p_args->'__embedding')='array' AND jsonb_array_length(p_args->'__embedding')=384 THEN
    v_embedding := replace((p_args->'__embedding')::text,' ','')::extensions.vector;
  END IF;
  DELETE FROM public.ai_job_knowledge_sources WHERE user_id=p_owner AND job_id=p_job_id;
  WITH matches AS (
    SELECT found.*,row_number() OVER(ORDER BY found.score DESC,found.similarity DESC,found.chunk_id) AS rnk
    FROM public.knowledge_match_chunks(p_owner,v_embedding,btrim(p_args->>'consulta'),v_top,'{}'::jsonb,NULL) found
    WHERE found.similarity IS NOT NULL AND found.similarity>=v_min
  ), inserted AS (
    INSERT INTO public.ai_job_knowledge_sources(user_id,job_id,rank,label,chunk_id,document_id,version_id,
      version_number,title,section_path,page_from,page_to,similarity,score)
    SELECT p_owner,p_job_id,rnk,'K'||rnk,chunk_id,document_id,version_id,version_number,title,section_path,
      page_from,page_to,similarity,score FROM matches RETURNING rank
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('label','K'||rnk,'document_id',document_id,'title',title,
    'version_number',version_number,'section_path',section_path,'page_from',page_from,'page_to',page_to,
    'content',content,'similarity',similarity,'score',score) ORDER BY rnk),'[]'::jsonb)
    INTO v_sources FROM matches;
  RETURN jsonb_build_object('items',v_sources);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_tool_knowledge_search(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_knowledge_search(uuid, uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

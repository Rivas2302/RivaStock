BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_user_id_id_unique ON public.ai_jobs(user_id, id);

CREATE TABLE public.ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  chat_id uuid,
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok boolean NOT NULL DEFAULT false,
  row_count integer,
  duration_ms integer,
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_tool_calls_job_owner_fk FOREIGN KEY(user_id, job_id)
    REFERENCES public.ai_jobs(user_id, id) ON DELETE CASCADE
);
CREATE INDEX ai_tool_calls_chat_created_idx ON public.ai_tool_calls(user_id, chat_id, created_at DESC);
CREATE INDEX ai_tool_calls_job_created_idx ON public.ai_tool_calls(user_id, job_id, created_at);
ALTER TABLE public.ai_tool_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_tool_calls_owner_read ON public.ai_tool_calls
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.ai_tool_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_tool_calls TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_tool_reserve_call(
  p_owner uuid, p_job_id uuid, p_chat_id uuid, p_tool text, p_args jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_calls integer;
BEGIN
  IF p_owner IS NULL OR p_job_id IS NULL OR p_tool IS NULL OR jsonb_typeof(p_args) <> 'object' THEN
    RAISE EXCEPTION 'Solicitud de herramienta inválida';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_job_id::text));
  IF NOT EXISTS (SELECT 1 FROM public.ai_jobs j WHERE j.id = p_job_id AND j.user_id = p_owner
    AND j.chat_id = p_chat_id AND j.status = 'processing') THEN
    RAISE EXCEPTION 'La tarea ya no está disponible';
  END IF;
  SELECT count(*) INTO v_calls FROM public.ai_tool_calls c WHERE c.user_id = p_owner AND c.job_id = p_job_id;
  IF v_calls >= 40 THEN RETURN NULL; END IF;
  INSERT INTO public.ai_tool_calls(user_id, job_id, chat_id, tool, args)
    VALUES (p_owner, p_job_id, p_chat_id, p_tool, p_args) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_tool_finish_call(
  p_owner uuid, p_id uuid, p_ok boolean, p_row_count integer, p_duration_ms integer, p_error text
 ) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_call public.ai_tool_calls%ROWTYPE;
BEGIN
  UPDATE public.ai_tool_calls SET ok = COALESCE(p_ok, false),
    row_count = CASE WHEN p_row_count IS NULL THEN NULL ELSE GREATEST(0, p_row_count) END,
    duration_ms = CASE WHEN p_duration_ms IS NULL THEN NULL ELSE GREATEST(0, p_duration_ms) END,
    error = CASE WHEN p_error IS NULL THEN NULL ELSE pg_catalog.left(p_error, 500) END
  WHERE id = p_id AND user_id = p_owner
  RETURNING * INTO v_call;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.ai_jobs AS job
  SET timings = COALESCE(job.timings, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'tool_calls', COALESCE(job.timings->'tool_calls', '[]'::jsonb) || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'tool', v_call.tool,
        'duration_ms', v_call.duration_ms,
        'row_count', v_call.row_count,
        'ok', v_call.ok
      )
    )
  )
  WHERE job.id = v_call.job_id AND job.user_id = p_owner;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_tool_read_impl(p_owner uuid, p_tool text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_module text;
  v_page integer := LEAST(GREATEST(COALESCE((p_args->>'pagina')::integer, 1), 1), 1000);
  v_limit integer := 25;
  v_text text := NULLIF(pg_catalog.btrim(p_args->>'texto'), '');
  v_category text := NULLIF(pg_catalog.btrim(p_args->>'categoria'), '');
  v_filter text := p_args->>'filtro';
  v_from date;
  v_until date;
  v_result jsonb;
  v_config jsonb;
BEGIN
  IF p_owner IS NULL OR pg_catalog.jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Solicitud de herramienta inválida';
  END IF;
  v_module := CASE p_tool
    WHEN 'productos_buscar' THEN 'stock' WHEN 'producto_ver' THEN 'stock' WHEN 'categorias_listar' THEN 'stock'
    WHEN 'ventas_resumen' THEN 'sales' WHEN 'ventas_listar' THEN 'sales' WHEN 'productos_mas_vendidos' THEN 'sales'
    WHEN 'pedidos_listar' THEN 'orders' WHEN 'pedido_ver' THEN 'orders' WHEN 'clientes_buscar' THEN 'customers'
    WHEN 'lista_revendedores_buscar' THEN 'resellers' WHEN 'stock_movimientos' THEN 'stock'
    WHEN 'conocimiento_buscar' THEN 'knowledge' ELSE NULL END;
  IF p_tool NOT IN ('negocio_resumen','productos_buscar','producto_ver','categorias_listar','ventas_resumen',
    'ventas_listar','productos_mas_vendidos','pedidos_listar','pedido_ver','clientes_buscar','catalogo_config',
    'lista_revendedores_buscar','stock_movimientos','conocimiento_buscar') THEN
    RAISE EXCEPTION 'Herramienta no permitida';
  END IF;
  IF v_module IS NOT NULL AND NOT public.business_module_enabled(p_owner, v_module) THEN
    RAISE EXCEPTION 'El módulo necesario no está incluido en el plan';
  END IF;

  IF p_tool = 'negocio_resumen' THEN
    RETURN COALESCE(public.ai_business_card(p_owner), '{}'::jsonb);
  ELSIF p_tool = 'productos_buscar' THEN
    SELECT pg_catalog.jsonb_build_object(
      'items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'nombre', p.name, 'categoria', COALESCE(NULLIF(p.category, ''), p.category_name),
        'precio_venta', p.sale_price, 'stock', p.stock, 'stock_minimo', p.min_stock,
        'tiene_foto', NULLIF(p.image_url, '') IS NOT NULL OR COALESCE(pg_catalog.cardinality(p.images), 0) > 0
      ) ORDER BY CASE WHEN p_args->>'orden' = 'precio' THEN p.sale_price END,
                     CASE WHEN p_args->>'orden' = 'stock' THEN p.stock END,
                     CASE WHEN p_args->>'orden' IS NULL OR p_args->>'orden' = 'nombre' THEN p.name END)
        FROM (SELECT product.*, category.name AS category_name FROM public.products product
          LEFT JOIN public.categories category ON category.id::text = product.category_id AND category.user_id = product.user_id
          WHERE product.user_id = p_owner
            AND (v_text IS NULL OR product.name ILIKE '%' || v_text || '%')
            AND (v_category IS NULL OR COALESCE(NULLIF(product.category, ''), category.name, '') ILIKE '%' || v_category || '%')
            AND (v_filter IS NULL OR (v_filter = 'sin_stock' AND product.stock <= 0)
              OR (v_filter = 'stock_bajo' AND product.stock <= product.min_stock)
              OR (v_filter = 'sin_foto' AND NULLIF(product.image_url, '') IS NULL AND COALESCE(pg_catalog.cardinality(product.images), 0) = 0)
              OR (v_filter = 'sin_precio' AND product.sale_price <= 0))
          ORDER BY CASE WHEN p_args->>'orden' = 'precio' THEN product.sale_price END,
                   CASE WHEN p_args->>'orden' = 'stock' THEN product.stock END,
                   CASE WHEN p_args->>'orden' IS NULL OR p_args->>'orden' = 'nombre' THEN product.name END
          LIMIT v_limit OFFSET ((v_page - 1) * v_limit)) p), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.products p LEFT JOIN public.categories c ON c.id::text = p.category_id AND c.user_id = p.user_id
        WHERE p.user_id = p_owner AND (v_text IS NULL OR p.name ILIKE '%' || v_text || '%')
          AND (v_category IS NULL OR COALESCE(NULLIF(p.category, ''), c.name, '') ILIKE '%' || v_category || '%')
          AND (v_filter IS NULL OR (v_filter = 'sin_stock' AND p.stock <= 0)
            OR (v_filter = 'stock_bajo' AND p.stock <= p.min_stock)
            OR (v_filter = 'sin_foto' AND NULLIF(p.image_url, '') IS NULL AND COALESCE(pg_catalog.cardinality(p.images), 0) = 0)
            OR (v_filter = 'sin_precio' AND p.sale_price <= 0))), 'pagina', v_page)
    INTO v_result;
    RETURN v_result;
  ELSIF p_tool = 'producto_ver' THEN
    SELECT pg_catalog.jsonb_build_object('id', p.id, 'nombre', p.name,
      'categoria', COALESCE(NULLIF(p.category, ''), c.name), 'descripcion', p.description,
      'precio_venta', p.sale_price, 'precio_compra', p.purchase_price, 'stock', p.stock,
      'stock_minimo', p.min_stock, 'imagen', p.image_url, 'imagenes', COALESCE(p.images, ARRAY[]::text[]))
      INTO v_result FROM public.products p LEFT JOIN public.categories c ON c.id::text = p.category_id AND c.user_id = p.user_id
      WHERE p.id = (p_args->>'product_id')::uuid AND p.user_id = p_owner;
    RETURN COALESCE(v_result, pg_catalog.jsonb_build_object('error', 'No se encontró el producto'));
  ELSIF p_tool = 'categorias_listar' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('categoria', q.category_name, 'productos', q.product_count)
      ORDER BY q.category_name), '[]'::jsonb) INTO v_result FROM (
        SELECT COALESCE(NULLIF(p.category, ''), c.name, 'Sin categoría') AS category_name, count(*) AS product_count
        FROM public.products p LEFT JOIN public.categories c ON c.id::text = p.category_id AND c.user_id = p.user_id
        WHERE p.user_id = p_owner GROUP BY 1
      ) q;
    RETURN pg_catalog.jsonb_build_object('items', v_result);
  ELSIF p_tool = 'ventas_resumen' OR p_tool = 'ventas_listar' OR p_tool = 'productos_mas_vendidos' THEN
    v_from := (p_args->>'desde')::date;
    v_until := (p_args->>'hasta')::date;
    IF v_from IS NULL OR v_until IS NULL OR v_until < v_from OR v_until - v_from > 365 THEN
      RAISE EXCEPTION 'El período debe estar dentro de 366 días';
    END IF;
    IF p_tool = 'ventas_resumen' THEN
      SELECT pg_catalog.jsonb_build_object('total_vendido', COALESCE(sum(s.total), 0), 'cantidad_ventas', count(*),
        'ticket_promedio', COALESCE(avg(s.total), 0), 'por_periodo', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('periodo', d.period, 'total', d.amount) ORDER BY d.period)
          FROM (SELECT CASE WHEN v_until - v_from <= 30 THEN s2.date::text ELSE pg_catalog.to_char(s2.date, 'YYYY-MM') END AS period, sum(s2.total) AS amount
            FROM public.sales s2 WHERE s2.user_id = p_owner AND s2.date BETWEEN v_from AND v_until AND s2.status <> 'No Pagado'
            GROUP BY 1) d), '[]'::jsonb))
        INTO v_result FROM public.sales s WHERE s.user_id = p_owner AND s.date BETWEEN v_from AND v_until AND s.status <> 'No Pagado';
      RETURN v_result;
    ELSIF p_tool = 'ventas_listar' THEN
      SELECT pg_catalog.jsonb_build_object('items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', q.id, 'fecha', q.date, 'cliente', q.client, 'total', q.total, 'estado', q.status)
        ORDER BY q.date DESC, q.created_at DESC) FROM (SELECT s.* FROM public.sales s WHERE s.user_id = p_owner
          AND s.date BETWEEN v_from AND v_until ORDER BY s.date DESC, s.created_at DESC
          LIMIT v_limit OFFSET ((v_page - 1) * v_limit)) q), '[]'::jsonb),
        'total', (SELECT count(*) FROM public.sales s WHERE s.user_id = p_owner AND s.date BETWEEN v_from AND v_until), 'pagina', v_page)
        INTO v_result;
      RETURN v_result;
    ELSE
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('producto', q.product_name_snapshot,
        'unidades', q.units, 'monto', q.amount) ORDER BY q.units DESC, q.product_name_snapshot), '[]'::jsonb)
        INTO v_result FROM (SELECT si.product_name_snapshot, sum(si.quantity) AS units, sum(si.line_total) AS amount
          FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id_snapshot AND s.user_id = si.user_id
          WHERE si.user_id = p_owner AND s.date BETWEEN v_from AND v_until AND si.reversed_at IS NULL
          GROUP BY si.product_name_snapshot ORDER BY sum(si.quantity) DESC LIMIT LEAST(GREATEST(COALESCE((p_args->>'limite')::integer, 10), 1), 20)) q;
      RETURN pg_catalog.jsonb_build_object('items', v_result);
    END IF;
  ELSIF p_tool = 'pedidos_listar' THEN
    SELECT pg_catalog.jsonb_build_object('items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', q.id, 'codigo', q.order_code, 'fecha', q.date, 'cliente', q.customer_name, 'total', q.total,
      'estado', q.status, 'origen', CASE WHEN q.channel = 'reseller' THEN 'revendedor' ELSE 'catalogo' END)
      ORDER BY q.created_at DESC) FROM (SELECT o.* FROM public.orders o WHERE o.user_id = p_owner
        AND (p_args->>'estado' IS NULL OR o.status = p_args->>'estado')
        AND (p_args->>'origen' IS NULL OR (p_args->>'origen' = 'revendedor' AND o.channel = 'reseller')
          OR (p_args->>'origen' = 'catalogo' AND o.channel <> 'reseller'))
        ORDER BY o.created_at DESC LIMIT v_limit OFFSET ((v_page - 1) * v_limit)) q), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.orders o WHERE o.user_id = p_owner
        AND (p_args->>'estado' IS NULL OR o.status = p_args->>'estado')
        AND (p_args->>'origen' IS NULL OR (p_args->>'origen' = 'revendedor' AND o.channel = 'reseller')
          OR (p_args->>'origen' = 'catalogo' AND o.channel <> 'reseller'))), 'pagina', v_page)
      INTO v_result;
    RETURN v_result;
  ELSIF p_tool = 'pedido_ver' THEN
    SELECT pg_catalog.jsonb_build_object('id', o.id, 'codigo', o.order_code, 'fecha', o.date,
      'cliente', o.customer_name, 'telefono', o.customer_phone, 'direccion', o.customer_address,
      'items', o.items, 'total', o.total, 'estado', o.status,
      'origen', CASE WHEN o.channel = 'reseller' THEN 'revendedor' ELSE 'catalogo' END)
      INTO v_result FROM public.orders o WHERE o.user_id = p_owner
        AND ((p_args ? 'order_id' AND o.id = (p_args->>'order_id')::uuid)
          OR (p_args ? 'codigo' AND o.order_code = p_args->>'codigo'));
    RETURN COALESCE(v_result, pg_catalog.jsonb_build_object('error', 'No se encontró el pedido'));
  ELSIF p_tool = 'clientes_buscar' THEN
    SELECT pg_catalog.jsonb_build_object('items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'nombre', q.name, 'telefono', q.phone, 'saldo', q.current_balance) ORDER BY q.name)
      FROM (SELECT c.* FROM public.customers c WHERE c.user_id = p_owner
        AND (c.name ILIKE '%' || v_text || '%' OR COALESCE(c.phone, '') ILIKE '%' || v_text || '%')
        ORDER BY c.name LIMIT v_limit OFFSET ((v_page - 1) * v_limit)) q), '[]'::jsonb), 'pagina', v_page)
      INTO v_result;
    RETURN v_result;
  ELSIF p_tool = 'catalogo_config' THEN
    SELECT to_jsonb(c) INTO v_config FROM public.catalog_config c WHERE c.user_id = p_owner ORDER BY c.updated_at DESC LIMIT 1;
    IF v_config IS NULL THEN RETURN pg_catalog.jsonb_build_object('publicado', false); END IF;
    RETURN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'publicado', COALESCE((v_config->>'enabled')::boolean, false),
      'nombre', v_config->>'business_name', 'enlace', 'https://rivastock.vercel.app/p/' || (v_config->>'slug'),
      'whatsapp', v_config->>'whatsapp_number', 'cinta', COALESCE(v_config->'presentation'->>'announcementText', v_config->'presentation'->>'announcement_text'),
      'modo_revendedor', EXISTS (SELECT 1 FROM public.reseller_supplier_lists r JOIN public.price_lists l
        ON l.id = r.price_list_id AND l.user_id = r.user_id WHERE r.user_id = p_owner AND r.enabled AND l.public_enabled)));
  ELSIF p_tool = 'lista_revendedores_buscar' THEN
    SELECT pg_catalog.jsonb_build_object('items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', q.id, 'nombre', q.name, 'precio_revendedor', q.reseller_price, 'tiene_foto', q.has_photo,
      'disponibilidad', q.availability) ORDER BY q.name)
      FROM (SELECT p.id, p.name, CASE WHEN i.pricing_mode = 'fixed' THEN i.fixed_price
        WHEN i.pricing_mode = 'discount' THEN round(p.sale_price * (1 - i.discount_percent / 100))
        ELSE round(p.sale_price * (1 - l.default_discount_percent / 100)) END AS reseller_price,
        NULLIF(p.image_url, '') IS NOT NULL OR COALESCE(pg_catalog.cardinality(p.images), 0) > 0 AS has_photo,
        i.availability FROM public.price_list_items i
        JOIN public.price_lists l ON l.id = i.price_list_id AND l.user_id = i.user_id
        JOIN public.products p ON p.id = i.product_id AND p.user_id = i.user_id
        WHERE i.user_id = p_owner AND l.kind = 'reseller' AND (v_text IS NULL OR p.name ILIKE '%' || v_text || '%')
        ORDER BY p.name LIMIT v_limit OFFSET ((v_page - 1) * v_limit)) q), '[]'::jsonb), 'pagina', v_page)
      INTO v_result;
    RETURN v_result;
  ELSIF p_tool = 'stock_movimientos' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('fecha', m.created_at,
      'movimiento', m.movement_type, 'cantidad', m.delta, 'stock_resultante', m.resulting_stock,
      'motivo', m.product_name_snapshot) ORDER BY m.created_at DESC), '[]'::jsonb)
      INTO v_result FROM (SELECT * FROM public.stock_movements
        WHERE user_id = p_owner AND product_id_snapshot = (p_args->>'product_id')::uuid
        ORDER BY created_at DESC LIMIT LEAST(GREATEST(COALESCE((p_args->>'limite')::integer, 20), 1), 50)) m;
    RETURN pg_catalog.jsonb_build_object('items', v_result);
  ELSIF p_tool = 'conocimiento_buscar' THEN
    IF jsonb_typeof(p_args->'__embedding') = 'array' AND jsonb_array_length(p_args->'__embedding') = 384 THEN
      SELECT COALESCE(pg_catalog.jsonb_agg(to_jsonb(m) ORDER BY m.score DESC), '[]'::jsonb)
        INTO v_result FROM public.knowledge_match_chunks(p_owner,
          pg_catalog.replace((p_args->'__embedding')::text, ' ', '')::extensions.vector,
          p_args->>'consulta', 8, '{}'::jsonb, NULL) m;
    ELSE
      SELECT COALESCE(pg_catalog.jsonb_agg(to_jsonb(m) ORDER BY m.score DESC), '[]'::jsonb)
        INTO v_result FROM public.knowledge_match_chunks(p_owner, NULL::extensions.vector,
          p_args->>'consulta', 8, '{}'::jsonb, NULL) m;
    END IF;
    RETURN pg_catalog.jsonb_build_object('items', v_result);
  END IF;
  RETURN '{}'::jsonb;
END;
$$;

DO $$
DECLARE tool_name text;
BEGIN
  FOREACH tool_name IN ARRAY ARRAY[
    'negocio_resumen','productos_buscar','producto_ver','categorias_listar','ventas_resumen','ventas_listar',
    'productos_mas_vendidos','pedidos_listar','pedido_ver','clientes_buscar','catalogo_config',
    'lista_revendedores_buscar','stock_movimientos','conocimiento_buscar'
  ] LOOP
    EXECUTE format('CREATE OR REPLACE FUNCTION public.ai_tool_%I(p_owner uuid, p_args jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '''' AS $f$ SELECT public.ai_tool_read_impl(p_owner, %L, p_args) $f$', tool_name, tool_name);
    EXECUTE format('REVOKE ALL ON FUNCTION public.ai_tool_%I(uuid, jsonb) FROM PUBLIC, anon, authenticated', tool_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.ai_tool_%I(uuid, jsonb) TO service_role', tool_name);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_tool_read_impl(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_read_impl(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.business_module_enabled(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_tool_reserve_call(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_reserve_call(uuid, uuid, uuid, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ai_tool_finish_call(uuid, uuid, boolean, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tool_finish_call(uuid, uuid, boolean, integer, integer, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

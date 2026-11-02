BEGIN;

ALTER TABLE public.ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_task_type_check;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_task_type_check
  CHECK (task_type IN ('text_generation', 'knowledge_organize', 'fb_copywriting'));

ALTER TABLE public.ai_function_settings
  ADD COLUMN business_tone text NOT NULL DEFAULT 'Amable, claro y profesional, sin exageraciones.';
ALTER TABLE public.ai_function_settings
  ADD CONSTRAINT ai_function_settings_business_tone_check
  CHECK (char_length(business_tone) BETWEEN 1 AND 500 AND btrim(business_tone) <> '');
COMMENT ON COLUMN public.ai_function_settings.business_tone IS
  'Owner-configured writing tone. Used only for Facebook copywriting; it does not add product facts.';

CREATE OR REPLACE FUNCTION public.request_fb_copywriting(
  p_product_id uuid,
  p_idempotency_key uuid,
  p_condition text,
  p_provider text DEFAULT NULL,
  p_model_id text DEFAULT NULL,
  p_reasoning_effort text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_setting public.ai_function_settings%ROWTYPE;
  v_job public.ai_jobs%ROWTYPE;
  v_existing public.ai_jobs%ROWTYPE;
  v_business_name text := '';
  v_provider text := 'codex';
  v_model_id text := 'gpt-6-luna';
  v_reasoning_effort text := 'low';
  v_job_model_id text;
  v_job_reasoning_effort text;
  v_tone text := 'Amable, claro y profesional, sin exageraciones.';
  v_knowledge jsonb := '[]'::jsonb;
  v_input text;
  v_pending integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede usar el módulo IA';
  END IF;
  IF p_product_id IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  IF p_condition IS NULL OR p_condition NOT IN ('new', 'like_new', 'good', 'fair') THEN
    RAISE EXCEPTION 'La condición seleccionada no es válida';
  END IF;

  SELECT * INTO v_product FROM public.products
  WHERE id = p_product_id AND user_id = v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el producto'; END IF;
  IF v_product.sale_price IS NULL OR v_product.sale_price <= 0 THEN
    RAISE EXCEPTION 'El producto necesita un precio de venta válido';
  END IF;

  SELECT COALESCE(NULLIF(btrim(business_name), ''), '') INTO v_business_name
  FROM public.profiles WHERE id = v_actor;
  v_business_name := COALESCE(v_business_name, '');

  SELECT * INTO v_setting FROM public.ai_function_settings
  WHERE user_id = v_actor AND function_key = 'fb_copywriting';
  IF FOUND THEN
    IF v_setting.provider NOT IN ('codex', 'claude') THEN
      RAISE EXCEPTION 'El proveedor configurado no está disponible para Redactar con IA';
    END IF;
    v_provider := v_setting.provider;
    v_model_id := v_setting.model_id;
    v_reasoning_effort := v_setting.reasoning_effort;
    v_tone := v_setting.business_tone;
  END IF;
  IF p_provider IS NOT NULL THEN
    IF p_provider NOT IN ('codex', 'claude') THEN
      RAISE EXCEPTION 'El proveedor elegido no está permitido';
    END IF;
    IF p_provider <> v_provider THEN
      v_provider := p_provider;
      v_model_id := CASE WHEN v_provider = 'codex' THEN 'gpt-6-luna' ELSE '' END;
      v_reasoning_effort := 'low';
    END IF;
  END IF;
  IF p_model_id IS NOT NULL THEN v_model_id := p_model_id; END IF;
  IF p_reasoning_effort IS NOT NULL THEN v_reasoning_effort := p_reasoning_effort; END IF;
  IF v_provider = 'codex' AND v_model_id NOT IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra') THEN
    RAISE EXCEPTION 'El modelo de Codex configurado no está permitido';
  END IF;
  IF v_provider = 'codex' AND v_reasoning_effort NOT IN ('low', 'medium', 'high', 'xhigh') THEN
    RAISE EXCEPTION 'El razonamiento de Codex elegido no está permitido';
  END IF;
  IF v_provider = 'claude' AND (v_model_id !~ '^[A-Za-z0-9._:/-]{1,120}$'
    OR p_reasoning_effort IS NOT NULL) THEN
    RAISE EXCEPTION 'El modelo de Claude elegido no es válido';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'title', left(btrim(item.value->>'title'), 160),
    'section_path', left(COALESCE(item.value->>'section_path', ''), 160),
    'content', left(btrim(item.value->>'content'), 700)
  ) ORDER BY item.ordinality), '[]'::jsonb)
  INTO v_knowledge
  FROM jsonb_array_elements(COALESCE(public.knowledge_search_chunks_text(
    left(COALESCE(v_product.name, '') || ' ' || COALESCE(v_product.category, ''), 500), 3, '{}'::jsonb
  ), '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
  WHERE NULLIF(btrim(item.value->>'title'), '') IS NOT NULL
    AND NULLIF(btrim(item.value->>'content'), '') IS NOT NULL;

  v_input := jsonb_build_object(
    'product', jsonb_build_object(
      'name', left(v_product.name, 500),
      'category', left(COALESCE(v_product.category, ''), 500),
      'description', left(COALESCE(v_product.description, ''), 2000),
      'price', v_product.sale_price,
      'stock', GREATEST(COALESCE(v_product.stock, 0), 0),
      'state', CASE WHEN COALESCE(v_product.stock, 0) > 0 THEN 'in_stock' ELSE 'out_of_stock' END
    ),
    'condition', p_condition,
    'business', jsonb_build_object('name', left(v_business_name, 160), 'tone', left(v_tone, 500)),
    'knowledge', v_knowledge,
    'provider_model_id', left(v_model_id, 120)
  )::text;
  IF char_length(v_input) > 8000 THEN RAISE EXCEPTION 'El contexto del producto supera el límite de redacción'; END IF;
  v_job_model_id := CASE WHEN v_provider = 'codex' THEN v_model_id ELSE NULL END;
  v_job_reasoning_effort := CASE WHEN v_provider = 'codex' THEN v_reasoning_effort ELSE NULL END;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_existing FROM public.ai_jobs
  WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.task_type <> 'fb_copywriting' OR v_existing.input <> v_input
      OR v_existing.provider <> v_provider
      OR v_existing.model_id IS DISTINCT FROM v_job_model_id
      OR v_existing.reasoning_effort IS DISTINCT FROM v_job_reasoning_effort THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otros datos';
    END IF;
    RETURN jsonb_build_object('job_id', v_existing.id);
  END IF;

  SELECT count(*) INTO v_pending FROM public.ai_jobs
  WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO public.ai_jobs (
    user_id, idempotency_key, provider, task_type, input,
    include_business_context, include_project_context, model_id, reasoning_effort
  ) VALUES (
    v_actor, p_idempotency_key, v_provider, 'fb_copywriting', v_input,
    false, false,
    v_job_model_id, v_job_reasoning_effort
  ) RETURNING * INTO v_job;
  RETURN jsonb_build_object('job_id', v_job.id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_fb_copywriting(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_fb_copywriting(uuid, uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_delete_task(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_chat_id uuid;
  v_task_type text;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede usar IA';
  END IF;
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Identificador de tarea inválido'; END IF;
  SELECT chat_id, task_type, status INTO v_chat_id, v_task_type, v_status
  FROM public.ai_jobs WHERE id = p_job_id AND user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la tarea'; END IF;
  IF v_chat_id IS NOT NULL OR v_task_type NOT IN ('text_generation', 'fb_copywriting') THEN
    RAISE EXCEPTION 'Solo se pueden borrar tareas puntuales de texto o redacción para Facebook';
  END IF;
  IF v_status IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Esperá a que termine la tarea antes de borrarla';
  END IF;
  DELETE FROM public.ai_jobs WHERE id = p_job_id AND user_id = v_actor;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_delete_all_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede usar IA';
  END IF;
  DELETE FROM public.ai_jobs WHERE user_id = v_actor AND chat_id IS NULL
    AND task_type IN ('text_generation', 'fb_copywriting') AND status IN ('completed', 'failed');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_apply_history_retention(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings public.ai_history_settings%ROWTYPE;
  v_cutoff timestamptz;
  v_deleted_chats integer := 0;
  v_deleted_tasks integer := 0;
BEGIN
  IF p_owner IS NULL THEN RAISE EXCEPTION 'Propietario inválido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_owner::text));
  SELECT * INTO v_settings FROM public.ai_history_settings WHERE user_id = p_owner FOR UPDATE;
  IF NOT FOUND OR v_settings.retention_days IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'deleted_chats', 0, 'deleted_tasks', 0);
  END IF;
  IF v_settings.last_retention_at >= now() - interval '6 hours' THEN
    RETURN jsonb_build_object('applied', false, 'deleted_chats', 0, 'deleted_tasks', 0);
  END IF;
  UPDATE public.ai_history_settings SET last_retention_at = now() WHERE user_id = p_owner;
  v_cutoff := now() - make_interval(days => v_settings.retention_days);
  INSERT INTO public.ai_chat_tombstones (chat_id, user_id, provider)
  SELECT chat.id, chat.user_id, chat.provider FROM public.ai_chats AS chat
  WHERE chat.user_id = p_owner AND chat.last_message_at < v_cutoff
    AND NOT EXISTS (SELECT 1 FROM public.ai_jobs AS job WHERE job.user_id = p_owner
      AND job.chat_id = chat.id AND job.status IN ('pending', 'processing'))
  ON CONFLICT (chat_id) DO UPDATE SET user_id = EXCLUDED.user_id, provider = EXCLUDED.provider,
    deleted_at = now(), cleaned_at = NULL;
  DELETE FROM public.ai_chats AS chat WHERE chat.user_id = p_owner AND chat.last_message_at < v_cutoff
    AND NOT EXISTS (SELECT 1 FROM public.ai_jobs AS job WHERE job.user_id = p_owner
      AND job.chat_id = chat.id AND job.status IN ('pending', 'processing'));
  GET DIAGNOSTICS v_deleted_chats = ROW_COUNT;
  DELETE FROM public.ai_jobs WHERE user_id = p_owner AND chat_id IS NULL
    AND task_type IN ('text_generation', 'fb_copywriting')
    AND status IN ('completed', 'failed') AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;
  RETURN jsonb_build_object('applied', true, 'deleted_chats', v_deleted_chats, 'deleted_tasks', v_deleted_tasks);
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

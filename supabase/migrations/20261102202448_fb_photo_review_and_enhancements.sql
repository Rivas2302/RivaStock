BEGIN;

ALTER TABLE public.ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_task_type_check;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_task_type_check
  CHECK (task_type IN ('text_generation', 'knowledge_organize', 'fb_copywriting', 'fb_photo_review'));

CREATE OR REPLACE FUNCTION public.request_fb_photo_review(
  p_product_id uuid,
  p_idempotency_key uuid,
  p_photo_urls text[],
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
  v_provider text := 'codex';
  v_model_id text := 'gpt-6-luna';
  v_reasoning_effort text := 'low';
  v_job_model_id text;
  v_job_reasoning_effort text;
  v_allowed_urls text[];
  v_input text;
  v_pending integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede usar IA';
  END IF;
  IF p_product_id IS NULL OR p_idempotency_key IS NULL
    OR p_photo_urls IS NULL OR cardinality(p_photo_urls) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'La solicitud de revisión de fotos no es válida';
  END IF;
  IF cardinality(p_photo_urls) <> (SELECT count(DISTINCT photo_url) FROM unnest(p_photo_urls) AS photo_url)
    OR array_position(p_photo_urls, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'La selección de fotos contiene duplicados o valores vacíos';
  END IF;

  SELECT * INTO v_product FROM public.products
  WHERE id = p_product_id AND user_id = v_actor
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el producto'; END IF;

  SELECT COALESCE(array_agg(DISTINCT CASE
    WHEN photo_url ~* '^http://[^/]+/storage/v1/object/public/assets/'
      THEN regexp_replace(photo_url, '^http:', 'https:', 'i')
    ELSE photo_url
  END), ARRAY[]::text[])
  INTO v_allowed_urls
  FROM unnest(COALESCE(v_product.images, ARRAY[]::text[]) || ARRAY[v_product.image_url]) AS photo_url;

  IF EXISTS (
    SELECT 1 FROM unnest(p_photo_urls) AS photo_url
    WHERE photo_url <> ALL(v_allowed_urls)
      OR photo_url !~* ('^https://[^/?#@]+/storage/v1/object/public/assets/'
        || v_actor::text || '/products/' || p_product_id::text
        || '/[^?#]+\.(jpg|jpeg|png|webp)$')
      OR char_length(photo_url) > 2000
  ) THEN
    RAISE EXCEPTION 'Seleccioná fotos actuales del producto almacenadas en RivaStock';
  END IF;

  SELECT * INTO v_setting FROM public.ai_function_settings
  WHERE user_id = v_actor AND function_key = 'fb_photo_review';
  IF FOUND THEN
    IF v_setting.provider NOT IN ('codex', 'claude') THEN
      RAISE EXCEPTION 'El proveedor configurado no admite la revisión de fotos';
    END IF;
    v_provider := v_setting.provider;
    v_model_id := v_setting.model_id;
    v_reasoning_effort := v_setting.reasoning_effort;
  END IF;
  IF p_provider IS NOT NULL THEN
    IF p_provider NOT IN ('codex', 'claude') THEN RAISE EXCEPTION 'El proveedor elegido no está permitido'; END IF;
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

  SELECT jsonb_build_object(
    'product_name', left(v_product.name, 500),
    'photos', jsonb_agg(jsonb_build_object(
      'id', 'IMG' || lpad(photo.ordinality::text, 3, '0'),
      'url', photo.photo_url,
      'mime_type', CASE
        WHEN photo.photo_url ~* '\.png$' THEN 'image/png'
        WHEN photo.photo_url ~* '\.webp$' THEN 'image/webp'
        ELSE 'image/jpeg'
      END
    ) ORDER BY photo.ordinality),
    'provider_model_id', left(v_model_id, 120)
  )::text
  INTO v_input
  FROM unnest(p_photo_urls) WITH ORDINALITY AS photo(photo_url, ordinality);
  IF char_length(v_input) > 8_000 THEN RAISE EXCEPTION 'La lista de fotos supera el límite de revisión'; END IF;

  v_job_model_id := CASE WHEN v_provider = 'codex' THEN v_model_id ELSE NULL END;
  v_job_reasoning_effort := CASE WHEN v_provider = 'codex' THEN v_reasoning_effort ELSE NULL END;
  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_existing FROM public.ai_jobs
  WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.task_type <> 'fb_photo_review' OR v_existing.input <> v_input
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
    v_actor, p_idempotency_key, v_provider, 'fb_photo_review', v_input,
    false, false, v_job_model_id, v_job_reasoning_effort
  ) RETURNING * INTO v_job;
  RETURN jsonb_build_object('job_id', v_job.id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_fb_photo_review(uuid, uuid, text[], text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_fb_photo_review(uuid, uuid, text[], text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.append_facebook_product_photo(
  p_product_id uuid,
  p_source_photo text,
  p_new_photo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_source text;
  v_source_origin text;
  v_new_origin text;
  v_new_path text;
  v_allowed_sources text[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM public.collaborators WHERE user_uid = v_actor AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede guardar fotos mejoradas';
  END IF;
  IF p_product_id IS NULL OR p_source_photo IS NULL OR p_new_photo IS NULL THEN
    RAISE EXCEPTION 'La foto mejorada no es válida';
  END IF;

  SELECT * INTO v_product FROM public.products
  WHERE id = p_product_id AND user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el producto'; END IF;

  v_source := CASE
    WHEN p_source_photo ~* '^http://[^/]+/storage/v1/object/public/assets/'
      THEN regexp_replace(p_source_photo, '^http:', 'https:', 'i')
    ELSE p_source_photo
  END;
  SELECT COALESCE(array_agg(DISTINCT CASE
    WHEN photo_url ~* '^http://[^/]+/storage/v1/object/public/assets/'
      THEN regexp_replace(photo_url, '^http:', 'https:', 'i')
    ELSE photo_url
  END), ARRAY[]::text[])
  INTO v_allowed_sources
  FROM unnest(COALESCE(v_product.images, ARRAY[]::text[]) || ARRAY[v_product.image_url]) AS photo_url;
  IF v_source !~* ('^https://[^/?#@]+/storage/v1/object/public/assets/'
    || v_actor::text || '/products/' || p_product_id::text || '/[^?#]+\.(jpg|jpeg|png|webp)$')
    OR v_source <> ALL(v_allowed_sources) THEN
    RAISE EXCEPTION 'La foto original ya no pertenece al producto';
  END IF;

  v_source_origin := substring(v_source FROM '^(https://[^/]+)');
  v_new_origin := substring(p_new_photo FROM '^(https://[^/]+)');
  v_new_path := substring(p_new_photo FROM '/storage/v1/object/public/assets/(.+)$');
  IF v_source_origin IS NULL OR v_new_origin IS NULL OR v_new_path IS NULL
    OR v_new_origin <> v_source_origin
    OR v_new_path !~ ('^' || v_actor::text || '/products/' || p_product_id::text
      || '/facebook-enhanced-[0-9a-f-]{36}\.(jpg|webp|png)$')
    OR p_new_photo <> (v_new_origin || '/storage/v1/object/public/assets/' || v_new_path) THEN
    RAISE EXCEPTION 'La foto nueva debe guardarse en la carpeta de producto de RivaStock';
  END IF;
  IF p_new_photo = ANY(COALESCE(v_product.images, ARRAY[]::text[]) || ARRAY[v_product.image_url]) THEN
    RAISE EXCEPTION 'La foto nueva ya está guardada en el producto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'assets' AND name = v_new_path) THEN
    RAISE EXCEPTION 'No se encontró el archivo nuevo en el almacenamiento';
  END IF;

  UPDATE public.products
  SET images = array_append(COALESCE(images, ARRAY[]::text[]), p_new_photo), updated_at = now()
  WHERE id = p_product_id AND user_id = v_actor
  RETURNING * INTO v_product;
  RETURN jsonb_build_object(
    'images', to_jsonb(v_product.images),
    'image_url', v_product.image_url,
    'updated_at', v_product.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.append_facebook_product_photo(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.append_facebook_product_photo(uuid, text, text)
  TO authenticated;

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
  IF v_chat_id IS NOT NULL OR v_task_type NOT IN ('text_generation', 'fb_copywriting', 'fb_photo_review') THEN
    RAISE EXCEPTION 'Solo se pueden borrar tareas puntuales de texto, redacción o revisión de fotos';
  END IF;
  IF v_status IN ('pending', 'processing') THEN RAISE EXCEPTION 'Esperá a que termine la tarea antes de borrarla'; END IF;
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
    AND task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review') AND status IN ('completed', 'failed');
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
    AND task_type IN ('text_generation', 'fb_copywriting', 'fb_photo_review')
    AND status IN ('completed', 'failed') AND created_at < v_cutoff;
  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;
  RETURN jsonb_build_object('applied', true, 'deleted_chats', v_deleted_chats, 'deleted_tasks', v_deleted_tasks);
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

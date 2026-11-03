BEGIN;

CREATE OR REPLACE FUNCTION public.business_require_module(p_owner uuid, p_module text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_owner IS NULL OR p_module IS NULL OR p_module NOT IN ('ai', 'knowledge', 'automation')
    OR COALESCE(public.business_limits(p_owner)->'modules'->>p_module, 'false') <> 'true' THEN
    RAISE EXCEPTION 'El módulo no está incluido en tu plan';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.business_require_module(uuid, text) FROM PUBLIC, anon, authenticated;

-- The owner helper also covers every Knowledge RPC and the table/storage RLS policies.
CREATE OR REPLACE FUNCTION public.knowledge_owner_for(p_action text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL OR p_action IS NULL OR p_action NOT IN ('read', 'write', 'delete') THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_uid AND revoked_at IS NULL
  ) THEN
    v_owner := v_uid;
  ELSIF public.has_permission(v_uid, 'conocimientos', p_action) THEN
    v_owner := public.get_owner_uid(v_uid);
  ELSE
    RETURN NULL;
  END IF;

  IF COALESCE(public.business_limits(v_owner)->'modules'->>'knowledge', 'false') <> 'true' THEN
    RETURN NULL;
  END IF;
  RETURN v_owner;
END;
$$;
REVOKE ALL ON FUNCTION public.knowledge_owner_for(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.knowledge_owner_for(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pair_ai_bridge_device(p_name text DEFAULT 'Mi PC')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_device_id uuid := gen_random_uuid();
  v_code text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_name text := left(btrim(COALESCE(p_name, 'Mi PC')), 80);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_user_id AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede vincular una computadora'; END IF;
  PERFORM public.business_require_module(v_user_id, 'ai');
  IF char_length(v_name) = 0 THEN RAISE EXCEPTION 'Nombre de computadora inválido'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  UPDATE public.ai_bridge_devices
    SET revoked_at = now(), state = 'idle', current_job_id = NULL
    WHERE user_id = v_user_id AND revoked_at IS NULL;
  UPDATE public.ai_bridge_device_secrets s
    SET pairing_hash = NULL, pairing_expires_at = NULL, token_hash = NULL
    FROM public.ai_bridge_devices d
    WHERE d.id = s.device_id AND d.user_id = v_user_id AND d.revoked_at IS NOT NULL;

  INSERT INTO public.ai_bridge_devices (id, user_id, name)
  VALUES (v_device_id, v_user_id, v_name);
  INSERT INTO public.ai_bridge_device_secrets (device_id, pairing_hash, pairing_expires_at)
  VALUES (v_device_id, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + interval '30 minutes');

  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'name', v_name,
    'pairing_code', v_code,
    'pairing_expires_at', now() + interval '30 minutes'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.pair_ai_bridge_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pair_ai_bridge_device(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_create_job_with_model(
  p_idempotency_key uuid,
  p_provider text,
  p_input text,
  p_include_business_context boolean,
  p_include_project_context boolean,
  p_model_id text DEFAULT NULL,
  p_reasoning_effort text DEFAULT NULL
)
RETURNS public.ai_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_job public.ai_jobs%ROWTYPE;
  v_pending_count integer;
  v_model_id text;
  v_reasoning_effort text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar el módulo IA'; END IF;
  PERFORM public.business_require_module(v_actor, 'ai');
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  IF p_provider NOT IN ('mock', 'codex', 'claude') THEN RAISE EXCEPTION 'Proveedor no permitido'; END IF;
  IF p_input IS NULL OR char_length(p_input) NOT BETWEEN 1 AND 8000 OR btrim(p_input) = '' THEN
    RAISE EXCEPTION 'La instrucción debe tener entre 1 y 8000 caracteres';
  END IF;

  v_model_id := CASE WHEN p_provider = 'codex' THEN COALESCE(p_model_id, 'gpt-6-luna') ELSE NULL END;
  v_reasoning_effort := CASE WHEN p_provider = 'codex' THEN COALESCE(p_reasoning_effort, 'low') ELSE NULL END;
  IF v_model_id NOT IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra') THEN RAISE EXCEPTION 'Modelo de Codex no permitido'; END IF;
  IF v_reasoning_effort NOT IN ('low', 'medium', 'high', 'xhigh') THEN RAISE EXCEPTION 'Nivel de razonamiento no permitido'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_job FROM public.ai_jobs
    WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_job.provider <> p_provider OR v_job.input <> p_input
      OR v_job.include_business_context <> p_include_business_context
      OR v_job.include_project_context <> p_include_project_context
      OR v_job.model_id IS DISTINCT FROM v_model_id
      OR v_job.reasoning_effort IS DISTINCT FROM v_reasoning_effort THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otros datos';
    END IF;
    RETURN v_job;
  END IF;

  SELECT count(*) INTO v_pending_count FROM public.ai_jobs
    WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO public.ai_jobs (
    user_id, idempotency_key, provider, input,
    include_business_context, include_project_context, model_id, reasoning_effort
  ) VALUES (
    v_actor, p_idempotency_key, p_provider, p_input,
    p_include_business_context, p_include_project_context, v_model_id, v_reasoning_effort
  ) RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_create_job_with_model(uuid, text, text, boolean, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_create_job_with_model(uuid, text, text, boolean, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_send_chat_message(
  p_idempotency_key uuid,
  p_provider text,
  p_input text,
  p_include_business_context boolean DEFAULT false,
  p_include_project_context boolean DEFAULT false,
  p_model_id text DEFAULT NULL,
  p_reasoning_effort text DEFAULT NULL,
  p_chat_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_chat public.ai_chats%ROWTYPE;
  v_job public.ai_jobs%ROWTYPE;
  v_pending_count integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar el módulo IA'; END IF;
  PERFORM public.business_require_module(v_actor, 'ai');
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('mock', 'codex', 'claude') THEN
    RAISE EXCEPTION 'Proveedor no permitido';
  END IF;
  IF p_input IS NULL OR char_length(p_input) NOT BETWEEN 1 AND 8000 OR p_input ~ '^[[:space:]]*$' THEN
    RAISE EXCEPTION 'El mensaje debe tener entre 1 y 8000 caracteres';
  END IF;
  IF p_include_business_context IS NULL OR p_include_project_context IS NULL THEN
    RAISE EXCEPTION 'Opciones de contexto inválidas';
  END IF;
  IF p_provider = 'codex' AND (
    p_model_id IS NULL OR p_model_id NOT IN ('gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra')
    OR p_reasoning_effort IS NULL OR p_reasoning_effort NOT IN ('low', 'medium', 'high', 'xhigh')
  ) THEN RAISE EXCEPTION 'Modelo o nivel de razonamiento inválido'; END IF;
  IF p_provider <> 'codex' AND (p_model_id IS NOT NULL OR p_reasoning_effort IS NOT NULL) THEN
    RAISE EXCEPTION 'La configuración enviada no corresponde al proveedor';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  SELECT * INTO v_job FROM public.ai_jobs
  WHERE user_id = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_job.chat_id IS NULL OR (p_chat_id IS NOT NULL AND v_job.chat_id IS DISTINCT FROM p_chat_id)
      OR v_job.provider <> p_provider OR v_job.input <> p_input
      OR v_job.include_business_context <> (p_provider <> 'mock' AND p_include_business_context)
      OR v_job.include_project_context <> (p_provider <> 'mock' AND p_include_project_context)
      OR v_job.model_id IS DISTINCT FROM p_model_id
      OR v_job.reasoning_effort IS DISTINCT FROM p_reasoning_effort THEN
      RAISE EXCEPTION 'La clave de solicitud ya se usó con otro mensaje';
    END IF;
    RETURN jsonb_build_object('chat_id', v_job.chat_id, 'job', to_jsonb(v_job));
  END IF;

  IF p_chat_id IS NULL THEN
    INSERT INTO public.ai_chats (user_id, provider, title, model_id, reasoning_effort)
    VALUES (v_actor, p_provider, left(btrim(regexp_replace(p_input, '[[:space:]]+', ' ', 'g')), 80), p_model_id, p_reasoning_effort)
    RETURNING * INTO v_chat;
  ELSE
    SELECT * INTO v_chat FROM public.ai_chats
    WHERE id = p_chat_id AND user_id = v_actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el chat'; END IF;
    IF v_chat.provider <> p_provider OR v_chat.model_id IS DISTINCT FROM p_model_id
      OR v_chat.reasoning_effort IS DISTINCT FROM p_reasoning_effort THEN
      RAISE EXCEPTION 'La configuración de este chat no se puede cambiar';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ai_jobs
      WHERE user_id = v_actor AND chat_id = v_chat.id AND status IN ('pending', 'processing')) THEN
      RAISE EXCEPTION 'Esperá a que termine la respuesta antes de enviar otro mensaje';
    END IF;
  END IF;

  SELECT count(*) INTO v_pending_count FROM public.ai_jobs
  WHERE user_id = v_actor AND status IN ('pending', 'processing');
  IF v_pending_count >= 10 THEN RAISE EXCEPTION 'Ya hay diez tareas pendientes o en ejecución'; END IF;

  INSERT INTO public.ai_jobs (
    user_id, idempotency_key, provider, input, include_business_context,
    include_project_context, model_id, reasoning_effort, chat_id
  ) VALUES (
    v_actor, p_idempotency_key, p_provider, p_input,
    p_provider <> 'mock' AND p_include_business_context,
    p_provider <> 'mock' AND p_include_project_context, p_model_id, p_reasoning_effort, v_chat.id
  ) RETURNING * INTO v_job;

  INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
  VALUES (v_actor, v_chat.id, v_job.id, 'user', p_input);
  UPDATE public.ai_chats SET updated_at = now(), last_message_at = now()
  WHERE id = v_chat.id AND user_id = v_actor;
  RETURN jsonb_build_object('chat_id', v_chat.id, 'job', to_jsonb(v_job));
END;
$$;
REVOKE ALL ON FUNCTION public.ai_send_chat_message(uuid, text, text, boolean, boolean, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_send_chat_message(uuid, text, text, boolean, boolean, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_jobs_require_business_module()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module text;
BEGIN
  v_module := CASE NEW.task_type
    WHEN 'knowledge_organize' THEN 'knowledge'
    WHEN 'fb_copywriting' THEN 'automation'
    WHEN 'fb_photo_review' THEN 'automation'
    ELSE 'ai'
  END;
  PERFORM public.business_require_module(NEW.user_id, v_module);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_jobs_require_business_module() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ai_jobs_require_business_module
  BEFORE INSERT OR UPDATE OF user_id, task_type ON public.ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.ai_jobs_require_business_module();

CREATE OR REPLACE FUNCTION public.ai_action_requests_require_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.business_require_module(NEW.user_id, 'automation');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_action_requests_require_automation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ai_action_requests_require_automation
  BEFORE INSERT OR UPDATE OF user_id, action_key ON public.ai_action_requests
  FOR EACH ROW EXECUTE FUNCTION public.ai_action_requests_require_automation();

CREATE OR REPLACE FUNCTION public.approve_facebook_publication(
  p_product uuid,
  p_intent uuid,
  p_content jsonb,
  p_groups uuid[],
  p_marketplace boolean,
  p_repeat_of uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := public.get_owner_uid(auth.uid());
BEGIN
  PERFORM public.business_require_module(v_owner, 'automation');
  IF NOT public.facebook_product_allowed(auth.uid(), p_product, true) THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_product::text, 0));
  IF EXISTS (SELECT 1 FROM public.facebook_publications WHERE user_id = v_owner AND intent_key = p_intent) THEN
    RETURN public.approve_facebook_publication_before_attempts(p_product, p_intent, p_content, p_groups, p_marketplace, p_repeat_of);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facebook_deliveries d JOIN public.facebook_publications p ON p.id = d.publication_id
    WHERE p.user_id = v_owner AND p.product_id = p_product AND d.recovery_required
      AND ((p_marketplace AND d.destination->>'mechanism' = 'marketplace') OR public.facebook_group_key(d.destination->>'url') IN (
        SELECT public.facebook_group_key(url) FROM public.facebook_groups WHERE id = ANY(p_groups) AND user_id = v_owner
      ))
  ) THEN RAISE EXCEPTION 'RECOVERY_REQUIRED'; END IF;
  RETURN public.approve_facebook_publication_before_attempts(p_product, p_intent, p_content, p_groups, p_marketplace, p_repeat_of);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication(uuid, uuid, jsonb, uuid[], boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication(uuid, uuid, jsonb, uuid[], boolean, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid, p_intent uuid, p_content jsonb, p_groups uuid[], p_marketplace boolean, p_mode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.business_require_module(public.get_owner_uid(auth.uid()), 'automation');
  RETURN public.approve_facebook_publication_v2_with_repeat(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_facebook_publication_v2(
  p_product uuid, p_intent uuid, p_content jsonb, p_groups uuid[], p_marketplace boolean, p_mode text, p_repeat_of uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.business_require_module(public.get_owner_uid(auth.uid()), 'automation');
  RETURN public.approve_facebook_publication_v2_with_repeat(
    p_product, p_intent, p_content, p_groups, p_marketplace, p_mode, p_repeat_of
  );
END;
$$;
REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_facebook_publication_v2(uuid, uuid, jsonb, uuid[], boolean, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

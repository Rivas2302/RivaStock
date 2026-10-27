BEGIN;

CREATE OR REPLACE FUNCTION public.ai_memory_update(
  p_id uuid,
  p_content text,
  p_pinned boolean DEFAULT false
)
RETURNS public.ai_memories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.ai_memory_user_guard();
  v_before public.ai_memories%ROWTYPE;
  v_after public.ai_memories%ROWTYPE;
  v_content text := btrim(COALESCE(p_content, ''));
BEGIN
  SELECT * INTO v_before FROM public.ai_memories
  WHERE id = p_id AND user_id = v_actor AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el recuerdo'; END IF;
  IF p_content IS NULL OR char_length(v_content) < 1
    OR (v_before.kind IN ('fact', 'preference') AND char_length(v_content) > 500)
    OR (v_before.kind = 'summary' AND char_length(v_content) > 2000)
    OR (COALESCE(p_pinned, false) AND v_before.kind <> 'preference') THEN
    RAISE EXCEPTION 'Recuerdo inválido';
  END IF;
  IF COALESCE(p_pinned, false) AND (
    SELECT COALESCE(sum(char_length(content)), 0) FROM public.ai_memories
    WHERE user_id = v_actor AND status = 'active' AND kind = 'preference' AND pinned AND id <> p_id
  ) + char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'Las preferencias fijadas no pueden superar 1000 caracteres';
  END IF;
  UPDATE public.ai_memories SET content = v_content, pinned = COALESCE(p_pinned, false),
    embedding = CASE WHEN content IS DISTINCT FROM v_content THEN NULL ELSE embedding END,
    embedding_model = CASE WHEN content IS DISTINCT FROM v_content THEN NULL ELSE embedding_model END,
    updated_at = now()
  WHERE id = p_id RETURNING * INTO v_after;
  INSERT INTO public.ai_memory_events (user_id, memory_id, action, before, after)
  VALUES (v_actor, p_id, 'updated', to_jsonb(v_before) - 'embedding', to_jsonb(v_after) - 'embedding');
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_undo(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.ai_memory_user_guard();
  v_event public.ai_memory_events%ROWTYPE;
  v_row public.ai_memories%ROWTYPE;
  v_action text;
  v_before_content text;
BEGIN
  SELECT * INTO v_event FROM public.ai_memory_events
  WHERE id = p_event_id AND user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el cambio de memoria'; END IF;
  IF v_event.action NOT IN ('created', 'updated', 'archived', 'restored') THEN
    RAISE EXCEPTION 'Este cambio no se puede deshacer';
  END IF;
  SELECT * INTO v_row FROM public.ai_memories
  WHERE id = v_event.memory_id AND user_id = v_actor FOR UPDATE;
  IF v_event.action = 'created' THEN
    IF NOT FOUND OR v_row.status <> 'active' OR v_row.updated_at > v_event.created_at THEN
      RAISE EXCEPTION 'El recuerdo cambió después; no se puede deshacer este alta';
    END IF;
    DELETE FROM public.ai_memories WHERE id = v_event.memory_id AND user_id = v_actor;
    INSERT INTO public.ai_memory_events (user_id, memory_id, action, before)
    VALUES (v_actor, v_event.memory_id, 'deleted', jsonb_build_object('undo_of', p_event_id));
    RETURN true;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'El recuerdo ya no existe'; END IF;
  IF v_event.action = 'updated' THEN
    IF v_row.content IS DISTINCT FROM v_event.after->>'content'
      OR v_row.pinned IS DISTINCT FROM (v_event.after->>'pinned')::boolean THEN
      RAISE EXCEPTION 'El recuerdo cambió después; no se puede deshacer este cambio';
    END IF;
    v_before_content := v_event.before->>'content';
    UPDATE public.ai_memories SET content = v_before_content,
      pinned = COALESCE((v_event.before->>'pinned')::boolean, false),
      embedding = CASE WHEN content IS DISTINCT FROM v_before_content THEN NULL ELSE embedding END,
      embedding_model = CASE WHEN content IS DISTINCT FROM v_before_content THEN NULL ELSE embedding_model END,
      updated_at = now()
    WHERE id = v_event.memory_id AND user_id = v_actor RETURNING * INTO v_row;
    v_action := 'updated';
  ELSIF v_event.action = 'archived' THEN
    IF v_row.status <> 'archived' THEN RAISE EXCEPTION 'El recuerdo cambió después'; END IF;
    UPDATE public.ai_memories SET status = 'active', pinned = COALESCE((v_event.before->>'pinned')::boolean, false),
      updated_at = now() WHERE id = v_event.memory_id AND user_id = v_actor RETURNING * INTO v_row;
    v_action := 'restored';
  ELSE
    IF v_row.status <> 'active' THEN RAISE EXCEPTION 'El recuerdo cambió después'; END IF;
    UPDATE public.ai_memories SET status = 'archived', pinned = false, updated_at = now()
    WHERE id = v_event.memory_id AND user_id = v_actor RETURNING * INTO v_row;
    v_action := 'archived';
  END IF;
  INSERT INTO public.ai_memory_events (user_id, memory_id, action, before, after)
  VALUES (v_actor, v_event.memory_id, v_action, to_jsonb(v_event.after) - 'embedding', to_jsonb(v_row) - 'embedding');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_pending_embeddings(p_owner uuid, p_worker uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_memories jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'content', content)
    ORDER BY created_at, id), '[]'::jsonb)
  INTO v_memories
  FROM (
    SELECT id, kind, content, created_at FROM public.ai_memories
    WHERE user_id = p_owner AND status = 'active' AND embedding IS NULL
      AND (kind IN ('fact', 'summary') OR (kind = 'preference' AND NOT pinned))
    ORDER BY created_at, id LIMIT 16
  ) AS pending;
  RETURN jsonb_build_object('memories', v_memories);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_store_embeddings(
  p_owner uuid,
  p_worker uuid,
  p_embeddings jsonb,
  p_model text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_embedding extensions.vector;
  v_stored integer := 0;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;
  IF p_model IS NULL OR char_length(p_model) < 1 OR char_length(p_model) > 120
    OR jsonb_typeof(p_embeddings) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_embeddings) < 1 OR jsonb_array_length(p_embeddings) > 16 THEN
    RAISE EXCEPTION 'Lote de embeddings inválido';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_embeddings)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_item->'embedding') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_item->'embedding') <> 384 THEN
      RAISE EXCEPTION 'Embedding inválido';
    END IF;
    v_embedding := replace((v_item->'embedding')::text, ' ', '')::extensions.vector;
    UPDATE public.ai_memories SET embedding = v_embedding, embedding_model = p_model, updated_at = now()
    WHERE id = (v_item->>'id')::uuid AND user_id = p_owner AND status = 'active'
      AND embedding IS NULL AND (kind IN ('fact', 'summary') OR (kind = 'preference' AND NOT pinned));
    IF FOUND THEN v_stored := v_stored + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('stored', v_stored);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_memory_pending_embeddings(uuid, uuid),
  public.ai_memory_store_embeddings(uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_memory_pending_embeddings(uuid, uuid),
  public.ai_memory_store_embeddings(uuid, uuid, jsonb, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

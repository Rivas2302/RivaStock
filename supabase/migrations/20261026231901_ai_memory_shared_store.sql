BEGIN;

CREATE TABLE public.ai_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fact', 'preference', 'summary')),
  content text NOT NULL,
  source_chat_id uuid,
  source_job_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'proposed')),
  pinned boolean NOT NULL DEFAULT false,
  superseded_by uuid,
  embedding extensions.vector(384),
  embedding_model text,
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at timestamptz,
  proposal_action text CHECK (proposal_action IS NULL OR proposal_action IN ('add', 'update', 'archive')),
  proposal_target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind IN ('fact', 'preference') AND char_length(content) BETWEEN 1 AND 500)
    OR (kind = 'summary' AND char_length(content) BETWEEN 1 AND 2000)
  ),
  CHECK (NOT pinned OR kind = 'preference'),
  CHECK ((status = 'proposed') = (proposal_action IS NOT NULL)),
  CHECK (proposal_action <> 'update' OR proposal_target_id IS NOT NULL)
);

CREATE INDEX ai_memories_owner_status_kind_idx
  ON public.ai_memories (user_id, status, kind);
CREATE INDEX ai_memories_embedding_hnsw_idx
  ON public.ai_memories USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL AND status = 'active';
CREATE INDEX ai_memories_owner_recent_idx
  ON public.ai_memories (user_id, updated_at DESC);

CREATE TABLE public.ai_memory_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'off')),
  top_k integer NOT NULL DEFAULT 5 CHECK (top_k BETWEEN 1 AND 10),
  include_summaries boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'archived', 'deleted', 'restored', 'used')),
  source_job_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_memory_events_owner_recent_idx
  ON public.ai_memory_events (user_id, created_at DESC);
CREATE INDEX ai_memory_events_source_job_idx
  ON public.ai_memory_events (user_id, source_job_id, created_at)
  WHERE source_job_id IS NOT NULL;

CREATE TABLE public.ai_memory_metrics (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_date date NOT NULL DEFAULT current_date,
  extractions_executed integer NOT NULL DEFAULT 0 CHECK (extractions_executed >= 0),
  skipped_prefilter integer NOT NULL DEFAULT 0 CHECK (skipped_prefilter >= 0),
  skipped_deduplication integer NOT NULL DEFAULT 0 CHECK (skipped_deduplication >= 0),
  provider_local integer NOT NULL DEFAULT 0 CHECK (provider_local >= 0),
  provider_codex integer NOT NULL DEFAULT 0 CHECK (provider_codex >= 0),
  PRIMARY KEY (user_id, metric_date)
);

-- A short-lived claim keeps the worker/job association verifiable after the answer is committed.
CREATE TABLE public.ai_memory_job_claims (
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  PRIMARY KEY (user_id, job_id),
  FOREIGN KEY (user_id, job_id) REFERENCES public.ai_jobs(user_id, id) ON DELETE CASCADE
);
CREATE INDEX ai_memory_job_claims_expiry_idx ON public.ai_memory_job_claims (expires_at);

ALTER TABLE public.ai_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_memory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_memory_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_memory_job_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_memories_owner_select ON public.ai_memories
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));
CREATE POLICY ai_memory_settings_owner_select ON public.ai_memory_settings
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));
CREATE POLICY ai_memory_events_owner_select ON public.ai_memory_events
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));
CREATE POLICY ai_memory_metrics_owner_select ON public.ai_memory_metrics
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = (SELECT auth.uid()) AND revoked_at IS NULL
  ));

REVOKE ALL ON public.ai_memories, public.ai_memory_settings, public.ai_memory_events,
  public.ai_memory_metrics, public.ai_memory_job_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_memories, public.ai_memory_settings, public.ai_memory_events,
  public.ai_memory_metrics TO authenticated;
REVOKE ALL ON public.ai_memories, public.ai_memory_settings, public.ai_memory_events,
  public.ai_memory_metrics, public.ai_memory_job_claims FROM service_role;

CREATE OR REPLACE FUNCTION public.ai_memory_user_guard()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE user_uid = v_actor AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Solo el propietario puede usar la memoria'; END IF;
  RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_memory_user_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_memory_create(
  p_kind text,
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
  v_row public.ai_memories%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('fact', 'preference', 'summary') OR p_content IS NULL
    OR char_length(btrim(p_content)) < 1
    OR (p_kind IN ('fact', 'preference') AND char_length(p_content) > 500)
    OR (p_kind = 'summary' AND char_length(p_content) > 2000)
    OR (COALESCE(p_pinned, false) AND p_kind <> 'preference') THEN
    RAISE EXCEPTION 'Recuerdo inválido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  IF COALESCE(p_pinned, false) AND (
    SELECT COALESCE(sum(char_length(content)), 0) FROM public.ai_memories
    WHERE user_id = v_actor AND status = 'active' AND kind = 'preference' AND pinned
  ) + char_length(p_content) > 1000 THEN
    RAISE EXCEPTION 'Las preferencias fijadas no pueden superar 1000 caracteres';
  END IF;
  IF (SELECT count(*) FROM public.ai_memories WHERE user_id = v_actor AND status = 'active') >= 1000 THEN
    WITH oldest AS (
      SELECT id FROM public.ai_memories
      WHERE user_id = v_actor AND status = 'active' AND kind = 'fact' AND NOT pinned
      ORDER BY use_count ASC, last_used_at ASC NULLS FIRST, created_at ASC
      LIMIT 1 FOR UPDATE
    )
    UPDATE public.ai_memories AS memory SET status = 'archived', updated_at = now()
    FROM oldest WHERE memory.id = oldest.id
    RETURNING memory.* INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Se alcanzó el límite de 1000 recuerdos activos'; END IF;
    INSERT INTO public.ai_memory_events (user_id, memory_id, action, before, after)
    VALUES (v_actor, v_row.id, 'archived',
      jsonb_set(to_jsonb(v_row), '{status}', '"active"'::jsonb) - 'embedding',
      to_jsonb(v_row) - 'embedding');
  END IF;
  INSERT INTO public.ai_memories (user_id, kind, content, pinned)
  VALUES (v_actor, p_kind, btrim(p_content), COALESCE(p_pinned, false))
  RETURNING * INTO v_row;
  INSERT INTO public.ai_memory_events (user_id, memory_id, action, after)
  VALUES (v_actor, v_row.id, 'created', to_jsonb(v_row) - 'embedding');
  RETURN v_row;
END;
$$;

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
BEGIN
  SELECT * INTO v_before FROM public.ai_memories
  WHERE id = p_id AND user_id = v_actor AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el recuerdo'; END IF;
  IF p_content IS NULL OR char_length(btrim(p_content)) < 1
    OR (v_before.kind IN ('fact', 'preference') AND char_length(p_content) > 500)
    OR (v_before.kind = 'summary' AND char_length(p_content) > 2000)
    OR (COALESCE(p_pinned, false) AND v_before.kind <> 'preference') THEN
    RAISE EXCEPTION 'Recuerdo inválido';
  END IF;
  IF COALESCE(p_pinned, false) AND (
    SELECT COALESCE(sum(char_length(content)), 0) FROM public.ai_memories
    WHERE user_id = v_actor AND status = 'active' AND kind = 'preference' AND pinned AND id <> p_id
  ) + char_length(p_content) > 1000 THEN
    RAISE EXCEPTION 'Las preferencias fijadas no pueden superar 1000 caracteres';
  END IF;
  UPDATE public.ai_memories SET content = btrim(p_content), pinned = COALESCE(p_pinned, false),
    updated_at = now() WHERE id = p_id RETURNING * INTO v_after;
  INSERT INTO public.ai_memory_events (user_id, memory_id, action, before, after)
  VALUES (v_actor, p_id, 'updated', to_jsonb(v_before) - 'embedding', to_jsonb(v_after) - 'embedding');
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_archive(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.ai_memory_user_guard();
  v_before public.ai_memories%ROWTYPE;
  v_after public.ai_memories%ROWTYPE;
BEGIN
  SELECT * INTO v_before FROM public.ai_memories
  WHERE id = p_id AND user_id = v_actor AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el recuerdo'; END IF;
  UPDATE public.ai_memories SET status = 'archived', pinned = false, updated_at = now()
  WHERE id = p_id RETURNING * INTO v_after;
  INSERT INTO public.ai_memory_events (user_id, memory_id, action, before, after)
  VALUES (v_actor, p_id, 'archived', to_jsonb(v_before) - 'embedding', to_jsonb(v_after) - 'embedding');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.ai_memory_user_guard();
  v_row public.ai_memories%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.ai_memories
  WHERE id = p_id AND user_id = v_actor AND status <> 'proposed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el recuerdo'; END IF;
  INSERT INTO public.ai_memory_events (user_id, memory_id, action, before)
  VALUES (v_actor, p_id, 'deleted', jsonb_build_object('kind', v_row.kind, 'deleted_at', now()));
  DELETE FROM public.ai_memories WHERE id = p_id AND user_id = v_actor;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_update_settings(
  p_mode text,
  p_top_k integer,
  p_include_summaries boolean
)
RETURNS public.ai_memory_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.ai_memory_user_guard();
  v_row public.ai_memory_settings%ROWTYPE;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('auto', 'confirm', 'off')
    OR p_top_k IS NULL OR p_top_k NOT BETWEEN 1 AND 10
    OR p_include_summaries IS NULL THEN RAISE EXCEPTION 'Ajustes de memoria inválidos'; END IF;
  INSERT INTO public.ai_memory_settings (user_id, mode, top_k, include_summaries)
  VALUES (v_actor, p_mode, p_top_k, p_include_summaries)
  ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, top_k = EXCLUDED.top_k,
    include_summaries = EXCLUDED.include_summaries, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
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
    IF v_row.content IS DISTINCT FROM v_event.after->>'content' OR v_row.pinned IS DISTINCT FROM (v_event.after->>'pinned')::boolean THEN
      RAISE EXCEPTION 'El recuerdo cambió después; no se puede deshacer este cambio';
    END IF;
    UPDATE public.ai_memories SET content = v_event.before->>'content',
      pinned = COALESCE((v_event.before->>'pinned')::boolean, false), updated_at = now()
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

CREATE OR REPLACE FUNCTION public.ai_memory_review_proposal(p_id uuid, p_accept boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.ai_memory_user_guard();
  v_proposal public.ai_memories%ROWTYPE;
  v_target public.ai_memories%ROWTYPE;
  v_after public.ai_memories%ROWTYPE;
BEGIN
  SELECT * INTO v_proposal FROM public.ai_memories
  WHERE id = p_id AND user_id = v_actor AND status = 'proposed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró la propuesta'; END IF;
  IF p_accept IS DISTINCT FROM true THEN
    UPDATE public.ai_memories SET status = 'archived', proposal_action = NULL,
      proposal_target_id = NULL, updated_at = now()
    WHERE id = p_id AND user_id = v_actor;
    RETURN true;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_actor::text));
  IF v_proposal.proposal_action = 'add' THEN
    IF (SELECT count(*) FROM public.ai_memories WHERE user_id = v_actor AND status = 'active') >= 1000 THEN
      WITH oldest AS (
        SELECT id FROM public.ai_memories
        WHERE user_id = v_actor AND status = 'active' AND kind = 'fact' AND NOT pinned
        ORDER BY use_count ASC, last_used_at ASC NULLS FIRST, created_at ASC
        LIMIT 1 FOR UPDATE
      )
      UPDATE public.ai_memories AS memory SET status = 'archived', updated_at = now()
      FROM oldest WHERE memory.id = oldest.id RETURNING memory.* INTO v_target;
      IF NOT FOUND THEN RAISE EXCEPTION 'Se alcanzó el límite de 1000 recuerdos activos'; END IF;
      INSERT INTO public.ai_memory_events (user_id, memory_id, action, before, after)
      VALUES (v_actor, v_target.id, 'archived',
        jsonb_set(to_jsonb(v_target), '{status}', '"active"'::jsonb) - 'embedding',
        to_jsonb(v_target) - 'embedding');
    END IF;
    UPDATE public.ai_memories SET status = 'active', proposal_action = NULL,
      proposal_target_id = NULL, updated_at = now()
    WHERE id = p_id AND user_id = v_actor RETURNING * INTO v_after;
    INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, after)
    VALUES (v_actor, p_id, 'created', v_after.source_job_id, to_jsonb(v_after) - 'embedding');
  ELSIF v_proposal.proposal_action = 'update' THEN
    SELECT * INTO v_target FROM public.ai_memories
    WHERE id = v_proposal.proposal_target_id AND user_id = v_actor AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El recuerdo de destino ya no está disponible'; END IF;
    UPDATE public.ai_memories SET content = v_proposal.content, embedding = v_proposal.embedding,
      embedding_model = v_proposal.embedding_model, updated_at = now()
    WHERE id = v_target.id RETURNING * INTO v_after;
    INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, before, after)
    VALUES (v_actor, v_target.id, 'updated', v_proposal.source_job_id,
      to_jsonb(v_target) - 'embedding', to_jsonb(v_after) - 'embedding');
    UPDATE public.ai_memories SET status = 'archived', proposal_action = NULL,
      proposal_target_id = NULL, updated_at = now()
    WHERE id = p_id AND user_id = v_actor;
  ELSIF v_proposal.proposal_action = 'archive' THEN
    SELECT * INTO v_target FROM public.ai_memories
    WHERE id = v_proposal.proposal_target_id AND user_id = v_actor AND status = 'active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El recuerdo de destino ya no está disponible'; END IF;
    UPDATE public.ai_memories SET status = 'archived', pinned = false, updated_at = now()
    WHERE id = v_target.id RETURNING * INTO v_after;
    INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, before, after)
    VALUES (v_actor, v_target.id, 'archived', v_proposal.source_job_id,
      to_jsonb(v_target) - 'embedding', to_jsonb(v_after) - 'embedding');
    UPDATE public.ai_memories SET status = 'archived', proposal_action = NULL,
      proposal_target_id = NULL, updated_at = now()
    WHERE id = p_id AND user_id = v_actor;
  ELSE
    RAISE EXCEPTION 'Operación de propuesta inválida';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_memory_worker(
  p_owner uuid,
  p_worker uuid,
  p_operation text,
  p_job_id uuid,
  p_payload jsonb
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
  v_result jsonb := '{}'::jsonb;
  v_item jsonb;
  v_memory_id uuid;
  v_chat_id uuid;
  v_turn_count integer := 0;
  v_message_count integer := 0;
  v_mode text := 'auto';
  v_top_k integer := 5;
  v_include_summaries boolean := true;
  v_operation jsonb;
  v_operation_kind text;
  v_target public.ai_memories%ROWTYPE;
  v_saved public.ai_memories%ROWTYPE;
  v_index integer := 0;
  v_provider text;
  v_metric text;
  v_content text;
  v_kind text;
  v_changed jsonb := '[]'::jsonb;
BEGIN
  IF p_owner IS NULL OR p_worker IS NULL OR p_operation IS NULL
    OR (p_job_id IS NULL AND p_operation NOT IN ('pending_embeddings', 'store_embeddings'))
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Worker inválido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_bridge_devices
    WHERE id = p_worker AND user_id = p_owner AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Computadora desvinculada'; END IF;
  IF p_operation = 'pending_embeddings' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'content', content)
      ORDER BY created_at, id), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT id, kind, content, created_at FROM public.ai_memories
      WHERE user_id = p_owner AND status = 'active' AND embedding IS NULL
        AND (kind = 'fact' OR (kind = 'preference' AND NOT pinned))
      ORDER BY created_at, id LIMIT 16
    ) AS pending;
    RETURN jsonb_build_object('memories', v_result);
  ELSIF p_operation = 'store_embeddings' THEN
    IF jsonb_typeof(p_payload->'embeddings') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_payload->'embeddings') > 16
      OR jsonb_typeof(p_payload->'model') IS DISTINCT FROM 'string'
      OR char_length(p_payload->>'model') > 120 THEN
      RAISE EXCEPTION 'Lote de embeddings inválido';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'embeddings')
    LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_item->'embedding') IS DISTINCT FROM 'array'
        OR jsonb_array_length(v_item->'embedding') <> 384 THEN
        RAISE EXCEPTION 'Embedding inválido';
      END IF;
      v_embedding := replace((v_item->'embedding')::text, ' ', '')::extensions.vector;
      UPDATE public.ai_memories SET embedding = v_embedding,
        embedding_model = p_payload->>'model', updated_at = now()
      WHERE id = (v_item->>'id')::uuid AND user_id = p_owner
        AND status = 'active' AND embedding IS NULL
        AND (kind = 'fact' OR (kind = 'preference' AND NOT pinned));
      IF FOUND THEN v_index := v_index + 1; END IF;
    END LOOP;
    RETURN jsonb_build_object('stored', COALESCE(v_index, 0));
  END IF;
  SELECT * INTO v_job FROM public.ai_jobs
  WHERE id = p_job_id AND user_id = p_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'La tarea no pertenece a este dueño'; END IF;
  v_chat_id := v_job.chat_id;

  IF p_operation = 'retrieve' THEN
    IF v_job.status <> 'processing' OR v_job.worker_id <> p_worker OR v_job.task_type <> 'text_generation' THEN
      RAISE EXCEPTION 'La tarea no está reservada por este worker';
    END IF;
  ELSIF p_operation IN ('similar', 'apply', 'metric', 'finish') THEN
    IF v_chat_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.ai_memory_job_claims
      WHERE user_id = p_owner AND job_id = p_job_id AND worker_id = p_worker AND expires_at > now()
    ) OR v_job.status NOT IN ('processing', 'completed') THEN
      RAISE EXCEPTION 'La tarea de memoria ya no está reservada por este worker';
    END IF;
  ELSE
    RAISE EXCEPTION 'Operación de memoria no permitida';
  END IF;

  SELECT * INTO v_settings FROM public.ai_memory_settings WHERE user_id = p_owner;
  IF FOUND THEN
    v_mode := v_settings.mode;
    v_top_k := v_settings.top_k;
    v_include_summaries := v_settings.include_summaries;
  END IF;

  IF p_operation = 'retrieve' THEN
    IF jsonb_typeof(p_payload->'embedding') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_payload->'embedding') <> 384
      OR jsonb_typeof(p_payload->'query') IS DISTINCT FROM 'string'
      OR char_length(p_payload->>'query') > 8000 THEN
      RAISE EXCEPTION 'Embedding o consulta inválidos';
    END IF;
    IF v_mode = 'off' THEN
      RETURN jsonb_build_object('enabled', false, 'memories', '[]'::jsonb,
        'user_turn_count', 0, 'message_count', 0, 'mode', v_mode);
    END IF;
    v_embedding := replace((p_payload->'embedding')::text, ' ', '')::extensions.vector;
    IF v_chat_id IS NOT NULL THEN
      INSERT INTO public.ai_memory_job_claims (user_id, job_id, worker_id)
      VALUES (p_owner, p_job_id, p_worker)
      ON CONFLICT (user_id, job_id) DO UPDATE SET worker_id = EXCLUDED.worker_id,
        expires_at = now() + interval '30 minutes';
      DELETE FROM public.ai_memory_job_claims WHERE user_id = p_owner AND expires_at <= now();
      SELECT count(*) FILTER (WHERE role = 'user'), count(*)
        INTO v_turn_count, v_message_count
      FROM public.ai_chat_messages WHERE user_id = p_owner AND chat_id = v_chat_id;
    END IF;

    WITH pinned_preferences AS (
      SELECT memory.*, NULL::double precision AS similarity, 0 AS sort_order
      FROM public.ai_memories AS memory
      WHERE memory.user_id = p_owner AND memory.status = 'active'
        AND memory.kind = 'preference' AND memory.pinned
      ORDER BY memory.updated_at DESC, memory.id
    ), facts AS (
      SELECT memory.*, (1 - (memory.embedding OPERATOR(extensions.<=>) v_embedding))::double precision AS similarity, 1 AS sort_order
      FROM public.ai_memories AS memory
      WHERE memory.user_id = p_owner AND memory.status = 'active' AND memory.kind = 'fact'
        AND memory.embedding IS NOT NULL
        AND (1 - (memory.embedding OPERATOR(extensions.<=>) v_embedding)) >= 0.75
      ORDER BY memory.embedding OPERATOR(extensions.<=>) v_embedding, memory.id
      LIMIT v_top_k
    ), summaries AS (
      SELECT memory.*, (1 - (memory.embedding OPERATOR(extensions.<=>) v_embedding))::double precision AS similarity, 2 AS sort_order
      FROM public.ai_memories AS memory
      WHERE memory.user_id = p_owner AND memory.status = 'active' AND memory.kind = 'summary'
        AND memory.embedding IS NOT NULL AND v_include_summaries
        AND memory.source_chat_id IS DISTINCT FROM v_chat_id
        AND (1 - (memory.embedding OPERATOR(extensions.<=>) v_embedding)) >= 0.78
      ORDER BY memory.embedding OPERATOR(extensions.<=>) v_embedding, memory.id
      LIMIT 2
    ), selected AS (
      SELECT * FROM pinned_preferences UNION ALL SELECT * FROM facts UNION ALL SELECT * FROM summaries
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'kind', kind, 'content', content, 'pinned', pinned,
      'source_chat_id', source_chat_id, 'source_job_id', source_job_id,
      'similarity', similarity, 'use_count', use_count, 'created_at', created_at
    ) ORDER BY sort_order, similarity DESC NULLS LAST, created_at DESC), '[]'::jsonb)
    INTO v_memories FROM selected;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_memories)
    LOOP
      v_memory_id := (v_item->>'id')::uuid;
      UPDATE public.ai_memories SET use_count = use_count + 1, last_used_at = now()
      WHERE id = v_memory_id AND user_id = p_owner;
      INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id)
      VALUES (p_owner, v_memory_id, 'used', p_job_id);
    END LOOP;
    RETURN jsonb_build_object('enabled', true, 'memories', v_memories,
      'user_turn_count', v_turn_count, 'message_count', v_message_count, 'mode', v_mode,
      'top_k', v_top_k, 'include_summaries', v_include_summaries);
  END IF;

  IF v_mode = 'off' THEN
    RETURN jsonb_build_object('enabled', false, 'changed', '[]'::jsonb);
  END IF;

  IF p_operation = 'similar' THEN
    IF jsonb_typeof(p_payload->'embedding') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_payload->'embedding') <> 384 THEN RAISE EXCEPTION 'Embedding inválido'; END IF;
    v_embedding := replace((p_payload->'embedding')::text, ' ', '')::extensions.vector;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'kind', kind, 'content', content, 'source_chat_id', source_chat_id,
      'similarity', similarity
    ) ORDER BY similarity DESC), '[]'::jsonb) INTO v_result
    FROM (
      SELECT memory.id, memory.kind, memory.content, memory.source_chat_id,
        (1 - (memory.embedding OPERATOR(extensions.<=>) v_embedding))::double precision AS similarity
      FROM public.ai_memories AS memory
      WHERE memory.user_id = p_owner AND memory.status = 'active'
        AND memory.embedding IS NOT NULL
        AND (1 - (memory.embedding OPERATOR(extensions.<=>) v_embedding)) >= 0.75
      ORDER BY memory.embedding OPERATOR(extensions.<=>) v_embedding, memory.id
      LIMIT 8
    ) AS matches;
    RETURN jsonb_build_object('enabled', true, 'memories', v_result);
  END IF;

  IF p_operation = 'metric' THEN
    v_metric := p_payload->>'metric';
    v_provider := p_payload->>'provider';
    IF v_metric NOT IN ('executed', 'skipped_prefilter', 'skipped_deduplication')
      OR (v_provider IS NOT NULL AND v_provider NOT IN ('local', 'codex')) THEN
      RAISE EXCEPTION 'Métrica de memoria inválida';
    END IF;
    INSERT INTO public.ai_memory_metrics (user_id, metric_date,
      extractions_executed, skipped_prefilter, skipped_deduplication, provider_local, provider_codex)
    VALUES (p_owner, current_date,
      CASE WHEN v_metric = 'executed' THEN 1 ELSE 0 END,
      CASE WHEN v_metric = 'skipped_prefilter' THEN 1 ELSE 0 END,
      CASE WHEN v_metric = 'skipped_deduplication' THEN 1 ELSE 0 END,
      CASE WHEN v_metric = 'executed' AND v_provider = 'local' THEN 1 ELSE 0 END,
      CASE WHEN v_metric = 'executed' AND v_provider = 'codex' THEN 1 ELSE 0 END)
    ON CONFLICT (user_id, metric_date) DO UPDATE SET
      extractions_executed = ai_memory_metrics.extractions_executed + EXCLUDED.extractions_executed,
      skipped_prefilter = ai_memory_metrics.skipped_prefilter + EXCLUDED.skipped_prefilter,
      skipped_deduplication = ai_memory_metrics.skipped_deduplication + EXCLUDED.skipped_deduplication,
      provider_local = ai_memory_metrics.provider_local + EXCLUDED.provider_local,
      provider_codex = ai_memory_metrics.provider_codex + EXCLUDED.provider_codex;
    RETURN jsonb_build_object('recorded', true);
  END IF;

  IF p_operation = 'finish' THEN
    DELETE FROM public.ai_memory_job_claims WHERE user_id = p_owner AND job_id = p_job_id AND worker_id = p_worker;
    RETURN jsonb_build_object('finished', true);
  END IF;

  IF p_operation <> 'apply' THEN RAISE EXCEPTION 'Operación de memoria no permitida'; END IF;
  IF jsonb_typeof(p_payload->'operations') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload->'operations') > 5 THEN RAISE EXCEPTION 'Operaciones de memoria inválidas'; END IF;
  FOR v_operation IN SELECT value FROM jsonb_array_elements(p_payload->'operations')
  LOOP
    v_target := NULL;
    v_saved := NULL;
    v_operation_kind := v_operation->>'op';
    IF v_operation_kind NOT IN ('add', 'update', 'archive') THEN RAISE EXCEPTION 'Operación de memoria inválida'; END IF;
    IF v_operation_kind = 'archive' THEN
      IF (v_operation->>'id') IS NULL THEN RAISE EXCEPTION 'Identificador de recuerdo inválido'; END IF;
      SELECT * INTO v_target FROM public.ai_memories
      WHERE id = (v_operation->>'id')::uuid AND user_id = p_owner AND status = 'active' FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
      IF v_mode = 'confirm' THEN
        INSERT INTO public.ai_memories (user_id, kind, content, source_chat_id, source_job_id,
          status, embedding, embedding_model, proposal_action, proposal_target_id)
        VALUES (p_owner, v_target.kind, v_target.content, v_chat_id, p_job_id,
          'proposed', v_target.embedding, v_target.embedding_model, 'archive', v_target.id)
        RETURNING * INTO v_saved;
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
          'kind', v_saved.kind, 'content', v_saved.content, 'proposal', true));
      ELSE
        UPDATE public.ai_memories SET status = 'archived', pinned = false, updated_at = now()
        WHERE id = v_target.id RETURNING * INTO v_saved;
        INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, before, after)
        VALUES (p_owner, v_saved.id, 'archived', p_job_id,
          to_jsonb(v_target) - 'embedding', to_jsonb(v_saved) - 'embedding');
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
          'kind', v_saved.kind, 'content', v_saved.content, 'archived', true));
      END IF;
      CONTINUE;
    END IF;

    v_kind := v_operation->>'kind';
    v_content := btrim(COALESCE(v_operation->>'content', ''));
    IF v_kind NOT IN ('fact', 'preference', 'summary') OR char_length(v_content) < 1
      OR (v_kind IN ('fact', 'preference') AND char_length(v_content) > 500)
      OR (v_kind = 'summary' AND char_length(v_content) > 2000)
      OR jsonb_typeof(v_operation->'embedding') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_operation->'embedding') <> 384 THEN
      RAISE EXCEPTION 'Recuerdo u embedding inválido';
    END IF;
    v_embedding := replace((v_operation->'embedding')::text, ' ', '')::extensions.vector;
    IF v_operation_kind = 'update' THEN
      SELECT * INTO v_target FROM public.ai_memories
      WHERE id = (v_operation->>'id')::uuid AND user_id = p_owner AND status = 'active' FOR UPDATE;
      IF NOT FOUND OR v_target.kind <> v_kind THEN CONTINUE; END IF;
      IF v_mode = 'confirm' THEN
        INSERT INTO public.ai_memories (user_id, kind, content, source_chat_id, source_job_id,
          status, embedding, embedding_model, proposal_action, proposal_target_id)
        VALUES (p_owner, v_kind, v_content, v_chat_id, p_job_id, 'proposed', v_embedding,
          COALESCE(p_payload->>'embedding_model', 'Xenova/multilingual-e5-small'), 'update', v_target.id)
        RETURNING * INTO v_saved;
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
          'kind', v_saved.kind, 'content', v_saved.content, 'proposal', true));
      ELSE
        UPDATE public.ai_memories SET content = v_content, embedding = v_embedding,
          embedding_model = COALESCE(p_payload->>'embedding_model', 'Xenova/multilingual-e5-small'),
          updated_at = now()
        WHERE id = v_target.id RETURNING * INTO v_saved;
        INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, before, after)
        VALUES (p_owner, v_saved.id, 'updated', p_job_id,
          to_jsonb(v_target) - 'embedding', to_jsonb(v_saved) - 'embedding');
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
          'kind', v_saved.kind, 'content', v_saved.content, 'updated', true));
      END IF;
    ELSE
      IF v_kind = 'summary' AND v_chat_id IS NOT NULL THEN
        SELECT * INTO v_target FROM public.ai_memories
        WHERE user_id = p_owner AND source_chat_id = v_chat_id AND kind = 'summary'
          AND status = 'active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
      ELSE
        v_target := NULL;
      END IF;
      IF v_target.id IS NOT NULL THEN
        IF v_mode = 'confirm' THEN
          INSERT INTO public.ai_memories (user_id, kind, content, source_chat_id, source_job_id,
            status, embedding, embedding_model, proposal_action, proposal_target_id)
          VALUES (p_owner, v_kind, v_content, v_chat_id, p_job_id, 'proposed', v_embedding,
            COALESCE(p_payload->>'embedding_model', 'Xenova/multilingual-e5-small'), 'update', v_target.id)
          RETURNING * INTO v_saved;
          v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
            'kind', v_saved.kind, 'content', v_saved.content, 'proposal', true));
        ELSE
          UPDATE public.ai_memories SET content = v_content, embedding = v_embedding,
            embedding_model = COALESCE(p_payload->>'embedding_model', 'Xenova/multilingual-e5-small'),
            source_job_id = p_job_id, updated_at = now()
          WHERE id = v_target.id RETURNING * INTO v_saved;
          INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, before, after)
          VALUES (p_owner, v_saved.id, 'updated', p_job_id,
            to_jsonb(v_target) - 'embedding', to_jsonb(v_saved) - 'embedding');
          v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
            'kind', v_saved.kind, 'content', v_saved.content, 'updated', true));
        END IF;
      ELSIF v_mode = 'confirm' THEN
        INSERT INTO public.ai_memories (user_id, kind, content, source_chat_id, source_job_id,
          status, embedding, embedding_model, proposal_action)
        VALUES (p_owner, v_kind, v_content, v_chat_id, p_job_id, 'proposed', v_embedding,
          COALESCE(p_payload->>'embedding_model', 'Xenova/multilingual-e5-small'), 'add')
        RETURNING * INTO v_saved;
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
          'kind', v_saved.kind, 'content', v_saved.content, 'proposal', true));
      ELSE
        IF (SELECT count(*) FROM public.ai_memories WHERE user_id = p_owner AND status = 'active') >= 1000 THEN
          WITH oldest AS (
            SELECT id FROM public.ai_memories
            WHERE user_id = p_owner AND status = 'active' AND kind = 'fact' AND NOT pinned
            ORDER BY use_count ASC, last_used_at ASC NULLS FIRST, created_at ASC
            LIMIT 1 FOR UPDATE
          )
          UPDATE public.ai_memories AS memory SET status = 'archived', updated_at = now()
          FROM oldest WHERE memory.id = oldest.id RETURNING memory.* INTO v_target;
          IF NOT FOUND THEN RAISE EXCEPTION 'Se alcanzó el límite de 1000 recuerdos activos'; END IF;
          INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, before, after)
          VALUES (p_owner, v_target.id, 'archived', p_job_id,
            jsonb_set(to_jsonb(v_target), '{status}', '"active"'::jsonb) - 'embedding',
            to_jsonb(v_target) - 'embedding');
        END IF;
        INSERT INTO public.ai_memories (user_id, kind, content, source_chat_id, source_job_id,
          status, embedding, embedding_model)
        VALUES (p_owner, v_kind, v_content, v_chat_id, p_job_id, 'active', v_embedding,
          COALESCE(p_payload->>'embedding_model', 'Xenova/multilingual-e5-small'))
        RETURNING * INTO v_saved;
        INSERT INTO public.ai_memory_events (user_id, memory_id, action, source_job_id, after)
        VALUES (p_owner, v_saved.id, 'created', p_job_id, to_jsonb(v_saved) - 'embedding');
        v_changed := v_changed || jsonb_build_array(jsonb_build_object('id', v_saved.id,
          'kind', v_saved.kind, 'content', v_saved.content, 'created', true));
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('enabled', true, 'changed', v_changed, 'mode', v_mode);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_memory_create(text, text, boolean),
  public.ai_memory_update(uuid, text, boolean), public.ai_memory_archive(uuid),
  public.ai_memory_delete(uuid), public.ai_memory_update_settings(text, integer, boolean),
  public.ai_memory_undo(uuid), public.ai_memory_review_proposal(uuid, boolean),
  public.ai_memory_worker(uuid, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_memory_create(text, text, boolean),
  public.ai_memory_update(uuid, text, boolean), public.ai_memory_archive(uuid),
  public.ai_memory_delete(uuid), public.ai_memory_update_settings(text, integer, boolean),
  public.ai_memory_undo(uuid), public.ai_memory_review_proposal(uuid, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_memory_worker(uuid, uuid, text, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

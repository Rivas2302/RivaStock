BEGIN;

-- ───────────────────────── Actor helper ─────────────────────────
-- Returns the owner UID whose knowledge the current user may access with the
-- given action, or NULL. Owners: always. Collaborators: only with the
-- 'conocimientos' permission (not granted by any preset yet).
CREATE OR REPLACE FUNCTION public.knowledge_owner_for(p_action text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_action IS NULL OR p_action NOT IN ('read', 'write', 'delete') THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL) THEN
    RETURN v_uid;
  END IF;
  IF has_permission(v_uid, 'conocimientos', p_action) THEN
    RETURN get_owner_uid(v_uid);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_require_owner(p_action text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_owner_for(p_action);
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin acceso a Conocimientos'; END IF;
  RETURN v_owner;
END;
$$;

-- ───────────────────────── Taxonomy ─────────────────────────
CREATE TABLE public.knowledge_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   uuid,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, parent_id) REFERENCES public.knowledge_folders(user_id, id) ON DELETE CASCADE,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX knowledge_folders_unique_name_idx ON public.knowledge_folders
  (user_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

CREATE TABLE public.knowledge_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  color       text NOT NULL DEFAULT 'slate'
              CHECK (color IN ('slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE UNIQUE INDEX knowledge_categories_unique_name_idx ON public.knowledge_categories (user_id, lower(btrim(name)));

CREATE TABLE public.knowledge_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE UNIQUE INDEX knowledge_tags_unique_name_idx ON public.knowledge_tags (user_id, lower(btrim(name)));

CREATE OR REPLACE FUNCTION public.knowledge_folders_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_depth integer := 1;
  v_cursor uuid := NEW.parent_id;
BEGIN
  WHILE v_cursor IS NOT NULL LOOP
    IF v_cursor = NEW.id THEN RAISE EXCEPTION 'Una carpeta no puede contenerse a sí misma'; END IF;
    v_depth := v_depth + 1;
    IF v_depth > 5 THEN RAISE EXCEPTION 'Las carpetas admiten hasta 5 niveles'; END IF;
    SELECT parent_id INTO v_cursor FROM knowledge_folders WHERE id = v_cursor AND user_id = NEW.user_id;
  END LOOP;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM knowledge_folders WHERE user_id = NEW.user_id) >= 500 THEN
    RAISE EXCEPTION 'Se alcanzó el máximo de 500 carpetas';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_folders_guard
  BEFORE INSERT OR UPDATE OF parent_id, name ON public.knowledge_folders
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_folders_guard();

-- ───────────────────────── Documents ─────────────────────────
CREATE TABLE public.knowledge_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                  text NOT NULL CHECK (kind IN ('file', 'editor')),
  format                text NOT NULL CHECK (format IN ('pdf', 'docx', 'txt', 'md', 'image', 'editor')),
  title                 text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  description           text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  folder_id             uuid,
  category_id           uuid,
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'in_review', 'published', 'archived', 'deleting')),
  rag_enabled           boolean NOT NULL DEFAULT true,
  current_version_id    uuid,
  published_version_id  uuid,
  draft_content         jsonb CHECK (draft_content IS NULL OR octet_length(draft_content::text) <= 2000000),
  draft_revision        integer NOT NULL DEFAULT 0,
  draft_updated_at      timestamptz,
  search_text           text NOT NULL DEFAULT '' CHECK (char_length(search_text) <= 100000),
  search_tsv            tsvector GENERATED ALWAYS AS (
                          setweight(to_tsvector('spanish', public.kb_unaccent(title)), 'A')
                          || setweight(to_tsvector('spanish', public.kb_unaccent(description)), 'B')
                          || setweight(to_tsvector('spanish', public.kb_unaccent(search_text)), 'C')
                        ) STORED,
  index_status          text NOT NULL DEFAULT 'not_indexed'
                        CHECK (index_status IN ('not_indexed', 'queued', 'processing', 'ready', 'error', 'excluded')),
  indexed_version_id    uuid,
  index_error           text CHECK (index_error IS NULL OR char_length(index_error) <= 1000),
  last_indexed_at       timestamptz,
  chunk_count           integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  published_at          timestamptz,
  archived_at           timestamptz,
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, folder_id) REFERENCES public.knowledge_folders(user_id, id) ON DELETE SET NULL (folder_id),
  FOREIGN KEY (user_id, category_id) REFERENCES public.knowledge_categories(user_id, id) ON DELETE SET NULL (category_id),
  CHECK ((kind = 'editor') = (format = 'editor'))
);
CREATE INDEX knowledge_documents_owner_updated_idx ON public.knowledge_documents (user_id, updated_at DESC);
CREATE INDEX knowledge_documents_owner_folder_idx ON public.knowledge_documents (user_id, folder_id);
CREATE INDEX knowledge_documents_search_idx ON public.knowledge_documents USING gin (search_tsv);

CREATE TABLE public.knowledge_document_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id        uuid NOT NULL,
  version_number     integer NOT NULL CHECK (version_number >= 1),
  source             text NOT NULL CHECK (source IN ('upload', 'editor', 'import', 'restore')),
  storage_path       text CHECK (storage_path IS NULL OR char_length(storage_path) <= 400),
  original_filename  text CHECK (original_filename IS NULL OR char_length(original_filename) <= 255),
  mime_type          text CHECK (mime_type IS NULL OR char_length(mime_type) <= 120),
  file_size          bigint CHECK (file_size IS NULL OR file_size BETWEEN 0 AND 52428800),
  content_json       jsonb CHECK (content_json IS NULL OR octet_length(content_json::text) <= 2000000),
  content_markdown   text CHECK (content_markdown IS NULL OR char_length(content_markdown) <= 500000),
  extracted_text     text CHECK (extracted_text IS NULL OR char_length(extracted_text) <= 2000000),
  extraction_status  text NOT NULL DEFAULT 'pending'
                     CHECK (extraction_status IN ('pending', 'done', 'not_supported', 'error')),
  page_count         integer CHECK (page_count IS NULL OR page_count >= 0),
  content_hash       text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  change_note        text NOT NULL DEFAULT '' CHECK (char_length(change_note) <= 300),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  UNIQUE (document_id, version_number),
  FOREIGN KEY (user_id, document_id) REFERENCES public.knowledge_documents(user_id, id) ON DELETE CASCADE,
  CHECK (storage_path IS NOT NULL OR content_json IS NOT NULL OR content_markdown IS NOT NULL)
);
CREATE INDEX knowledge_versions_owner_doc_idx ON public.knowledge_document_versions (user_id, document_id, version_number DESC);

ALTER TABLE public.knowledge_documents
  ADD FOREIGN KEY (user_id, current_version_id)
    REFERENCES public.knowledge_document_versions(user_id, id) ON DELETE SET NULL (current_version_id),
  ADD FOREIGN KEY (user_id, published_version_id)
    REFERENCES public.knowledge_document_versions(user_id, id) ON DELETE SET NULL (published_version_id),
  ADD FOREIGN KEY (user_id, indexed_version_id)
    REFERENCES public.knowledge_document_versions(user_id, id) ON DELETE SET NULL (indexed_version_id);

CREATE TABLE public.knowledge_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL,
  storage_path  text NOT NULL UNIQUE CHECK (char_length(storage_path) <= 400),
  mime_type     text NOT NULL CHECK (mime_type IN ('image/webp', 'image/png', 'image/jpeg')),
  file_size     bigint NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, document_id) REFERENCES public.knowledge_documents(user_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_assets_owner_doc_idx ON public.knowledge_assets (user_id, document_id);

CREATE TABLE public.knowledge_document_tags (
  user_id      uuid NOT NULL,
  document_id  uuid NOT NULL,
  tag_id       uuid NOT NULL,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (user_id, document_id) REFERENCES public.knowledge_documents(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tag_id) REFERENCES public.knowledge_tags(user_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_document_tags_tag_idx ON public.knowledge_document_tags (user_id, tag_id);

-- Append-only history. No FK to documents so history survives deletion.
CREATE TABLE public.knowledge_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id  uuid,
  actor_uid    uuid,
  action       text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(details::text) <= 4000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_events_owner_created_idx ON public.knowledge_events (user_id, created_at DESC);
CREATE INDEX knowledge_events_owner_doc_idx ON public.knowledge_events (user_id, document_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.knowledge_log(p_owner uuid, p_document_id uuid, p_action text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO knowledge_events (user_id, document_id, actor_uid, action, details)
  VALUES (p_owner, p_document_id, auth.uid(), p_action, COALESCE(p_details, '{}'::jsonb));
$$;

-- ───────────────────────── RLS ─────────────────────────
ALTER TABLE public.knowledge_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_folders_read ON public.knowledge_folders FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_folders_insert ON public.knowledge_folders FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT public.knowledge_owner_for('write')));
CREATE POLICY knowledge_folders_update ON public.knowledge_folders FOR UPDATE TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('write')))
  WITH CHECK (user_id = (SELECT public.knowledge_owner_for('write')));
CREATE POLICY knowledge_folders_delete ON public.knowledge_folders FOR DELETE TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('delete')));

CREATE POLICY knowledge_categories_read ON public.knowledge_categories FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_categories_insert ON public.knowledge_categories FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT public.knowledge_owner_for('write')));
CREATE POLICY knowledge_categories_update ON public.knowledge_categories FOR UPDATE TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('write')))
  WITH CHECK (user_id = (SELECT public.knowledge_owner_for('write')));
CREATE POLICY knowledge_categories_delete ON public.knowledge_categories FOR DELETE TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('delete')));

CREATE POLICY knowledge_tags_read ON public.knowledge_tags FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_tags_insert ON public.knowledge_tags FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT public.knowledge_owner_for('write')));
CREATE POLICY knowledge_tags_update ON public.knowledge_tags FOR UPDATE TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('write')))
  WITH CHECK (user_id = (SELECT public.knowledge_owner_for('write')));
CREATE POLICY knowledge_tags_delete ON public.knowledge_tags FOR DELETE TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('delete')));

CREATE POLICY knowledge_documents_read ON public.knowledge_documents FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_versions_read ON public.knowledge_document_versions FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_assets_read ON public.knowledge_assets FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_document_tags_read ON public.knowledge_document_tags FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));
CREATE POLICY knowledge_events_read ON public.knowledge_events FOR SELECT TO authenticated
  USING (user_id = (SELECT public.knowledge_owner_for('read')));

REVOKE ALL ON public.knowledge_folders, public.knowledge_categories, public.knowledge_tags,
  public.knowledge_documents, public.knowledge_document_versions, public.knowledge_assets,
  public.knowledge_document_tags, public.knowledge_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_folders, public.knowledge_categories,
  public.knowledge_tags TO authenticated;
GRANT SELECT ON public.knowledge_documents, public.knowledge_document_versions,
  public.knowledge_assets, public.knowledge_document_tags, public.knowledge_events TO authenticated;

-- Formats ↔ MIME types accepted per document format.
CREATE OR REPLACE FUNCTION public.knowledge_mime_allowed(p_format text, p_mime text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_format
    WHEN 'pdf'   THEN p_mime = 'application/pdf'
    WHEN 'docx'  THEN p_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'txt'   THEN p_mime = 'text/plain'
    WHEN 'md'    THEN p_mime IN ('text/markdown', 'text/x-markdown', 'text/plain')
    WHEN 'image' THEN p_mime IN ('image/png', 'image/jpeg', 'image/webp')
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.knowledge_storage_used(p_owner uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT sum(file_size) FROM (
           SELECT DISTINCT ON (storage_path) storage_path, file_size
           FROM knowledge_document_versions
           WHERE user_id = p_owner AND storage_path IS NOT NULL
         ) v), 0)
       + COALESCE((SELECT sum(file_size) FROM knowledge_assets WHERE user_id = p_owner), 0)
$$;

CREATE OR REPLACE FUNCTION public.knowledge_create_document(
  p_kind text,
  p_format text,
  p_title text,
  p_description text DEFAULT '',
  p_folder_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL
)
RETURNS public.knowledge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('file', 'editor') THEN RAISE EXCEPTION 'Tipo de documento inválido'; END IF;
  IF (p_kind = 'editor') <> (p_format = 'editor') THEN RAISE EXCEPTION 'Formato inválido'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || v_owner::text, 0));
  IF (SELECT count(*) FROM knowledge_documents WHERE user_id = v_owner) >= 2000 THEN
    RAISE EXCEPTION 'Se alcanzó el máximo de 2000 documentos';
  END IF;
  INSERT INTO knowledge_documents (user_id, kind, format, title, description, folder_id, category_id,
    draft_content, draft_updated_at, created_by, updated_by)
  VALUES (v_owner, p_kind, p_format, btrim(p_title), COALESCE(btrim(p_description), ''), p_folder_id, p_category_id,
    CASE WHEN p_kind = 'editor' THEN '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb END,
    CASE WHEN p_kind = 'editor' THEN now() END, auth.uid(), auth.uid())
  RETURNING * INTO v_doc;
  PERFORM knowledge_log(v_owner, v_doc.id, 'created', jsonb_build_object('title', v_doc.title, 'format', v_doc.format));
  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_add_file_version(
  p_document_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size bigint,
  p_content_hash text,
  p_extracted_text text DEFAULT NULL,
  p_change_note text DEFAULT ''
)
RETURNS public.knowledge_document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_next integer;
  v_status text;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF v_doc.kind <> 'file' THEN RAISE EXCEPTION 'Este documento se edita con el editor'; END IF;
  IF v_doc.status IN ('archived', 'deleting') THEN RAISE EXCEPTION 'Restaurá el documento antes de agregar versiones'; END IF;
  IF p_storage_path IS NULL OR p_storage_path !~ ('^' || v_owner::text || '/' || v_doc.id::text || '/v[0-9]{1,5}/[A-Za-z0-9._-]{1,120}$') THEN
    RAISE EXCEPTION 'Ruta de archivo inválida';
  END IF;
  IF NOT knowledge_mime_allowed(v_doc.format, p_mime_type) THEN RAISE EXCEPTION 'Tipo de archivo no permitido'; END IF;
  IF p_file_size IS NULL OR p_file_size < 1 OR p_file_size > 52428800 THEN RAISE EXCEPTION 'El archivo supera 50 MB'; END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Huella de archivo inválida'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || v_owner::text, 0));
  IF knowledge_storage_used(v_owner) + p_file_size > 1073741824 THEN
    RAISE EXCEPTION 'Se alcanzó el límite de 1 GB de almacenamiento';
  END IF;

  v_status := CASE
    WHEN p_extracted_text IS NOT NULL THEN 'done'
    WHEN v_doc.format = 'image' THEN 'not_supported'
    ELSE 'pending'
  END;
  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM knowledge_document_versions WHERE document_id = v_doc.id;

  INSERT INTO knowledge_document_versions (user_id, document_id, version_number, source, storage_path,
    original_filename, mime_type, file_size, extracted_text, extraction_status, content_hash, change_note, created_by)
  VALUES (v_owner, v_doc.id, v_next, 'upload', p_storage_path, left(p_original_filename, 255), p_mime_type, p_file_size,
    left(p_extracted_text, 2000000), v_status, p_content_hash, left(COALESCE(p_change_note, ''), 300), auth.uid())
  RETURNING * INTO v_version;

  UPDATE knowledge_documents SET current_version_id = v_version.id,
    search_text = left(COALESCE(p_extracted_text, ''), 100000),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id;
  PERFORM knowledge_log(v_owner, v_doc.id, 'version_added',
    jsonb_build_object('version', v_next, 'filename', left(p_original_filename, 120), 'size', p_file_size));
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_save_draft(p_document_id uuid, p_content jsonb, p_expected_revision integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' OR p_content->>'type' <> 'doc' THEN
    RAISE EXCEPTION 'Contenido inválido';
  END IF;
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF v_doc.kind <> 'editor' THEN RAISE EXCEPTION 'Este documento no usa el editor'; END IF;
  IF v_doc.status IN ('archived', 'deleting') THEN RAISE EXCEPTION 'Restaurá el documento antes de editarlo'; END IF;
  IF v_doc.draft_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'El documento cambió en otra pestaña o dispositivo';
  END IF;
  UPDATE knowledge_documents SET draft_content = p_content, draft_revision = draft_revision + 1,
    draft_updated_at = now(), updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id
  RETURNING * INTO v_doc;
  RETURN jsonb_build_object('draft_revision', v_doc.draft_revision, 'draft_updated_at', v_doc.draft_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_save_editor_version(
  p_document_id uuid,
  p_content_json jsonb,
  p_content_markdown text,
  p_plain_text text,
  p_content_hash text,
  p_expected_revision integer,
  p_change_note text DEFAULT ''
)
RETURNS public.knowledge_document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
  v_current knowledge_document_versions%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_next integer;
BEGIN
  IF p_content_json IS NULL OR p_content_json->>'type' <> 'doc' THEN RAISE EXCEPTION 'Contenido inválido'; END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Huella inválida'; END IF;
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF v_doc.kind <> 'editor' THEN RAISE EXCEPTION 'Este documento no usa el editor'; END IF;
  IF v_doc.status IN ('archived', 'deleting') THEN RAISE EXCEPTION 'Restaurá el documento antes de editarlo'; END IF;
  IF v_doc.draft_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'El documento cambió en otra pestaña o dispositivo';
  END IF;

  SELECT * INTO v_current FROM knowledge_document_versions WHERE id = v_doc.current_version_id;
  IF FOUND AND v_current.content_hash = p_content_hash THEN
    RETURN v_current; -- No duplicate versions for identical content.
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM knowledge_document_versions WHERE document_id = v_doc.id;
  INSERT INTO knowledge_document_versions (user_id, document_id, version_number, source, content_json,
    content_markdown, extracted_text, extraction_status, content_hash, change_note, created_by)
  VALUES (v_owner, v_doc.id, v_next, 'editor', p_content_json, left(p_content_markdown, 500000),
    left(p_plain_text, 2000000), 'done', p_content_hash, left(COALESCE(p_change_note, ''), 300), auth.uid())
  RETURNING * INTO v_version;

  UPDATE knowledge_documents SET current_version_id = v_version.id, draft_content = p_content_json,
    draft_revision = draft_revision + 1, draft_updated_at = now(),
    search_text = left(COALESCE(p_plain_text, ''), 100000), updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id;
  PERFORM knowledge_log(v_owner, v_doc.id, 'version_added', jsonb_build_object('version', v_next, 'source', 'editor'));
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_set_status(p_document_id uuid, p_status text, p_note text DEFAULT '')
RETURNS public.knowledge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
  v_from text;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  v_from := v_doc.status;
  IF NOT (
       (v_from = 'draft'     AND p_status IN ('in_review', 'published', 'archived'))
    OR (v_from = 'in_review' AND p_status IN ('draft', 'published', 'archived'))
    OR (v_from = 'published' AND p_status IN ('draft', 'archived', 'published'))
    OR (v_from = 'archived'  AND p_status = 'draft')
  ) THEN
    RAISE EXCEPTION 'Cambio de estado no permitido';
  END IF;
  IF p_status = 'published' AND v_doc.current_version_id IS NULL THEN
    RAISE EXCEPTION 'Guardá una versión antes de publicar';
  END IF;
  IF p_status = 'published' AND v_from = 'published' AND v_doc.published_version_id = v_doc.current_version_id THEN
    RAISE EXCEPTION 'La versión actual ya está publicada';
  END IF;

  UPDATE knowledge_documents SET
    status = p_status,
    published_version_id = CASE WHEN p_status = 'published' THEN current_version_id ELSE published_version_id END,
    published_at = CASE WHEN p_status = 'published' THEN now() ELSE published_at END,
    archived_at = CASE WHEN p_status = 'archived' THEN now() WHEN p_status = 'draft' THEN NULL ELSE archived_at END,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id
  RETURNING * INTO v_doc;
  PERFORM knowledge_log(v_owner, v_doc.id, 'status_changed', jsonb_build_object(
    'from', v_from, 'to', p_status, 'note', left(COALESCE(p_note, ''), 300),
    'version_id', CASE WHEN p_status = 'published' THEN v_doc.published_version_id END));
  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_update_metadata(
  p_document_id uuid,
  p_title text,
  p_description text,
  p_folder_id uuid,
  p_category_id uuid,
  p_tag_ids uuid[]
)
RETURNS public.knowledge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_doc.status = 'deleting' THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF COALESCE(cardinality(p_tag_ids), 0) > 20 THEN RAISE EXCEPTION 'Máximo 20 etiquetas por documento'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_tag_ids, '{}')) t(id)
             WHERE NOT EXISTS (SELECT 1 FROM knowledge_tags k WHERE k.id = t.id AND k.user_id = v_owner)) THEN
    RAISE EXCEPTION 'Etiqueta inválida';
  END IF;
  UPDATE knowledge_documents SET title = btrim(p_title), description = COALESCE(btrim(p_description), ''),
    folder_id = p_folder_id, category_id = p_category_id, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id RETURNING * INTO v_doc;
  DELETE FROM knowledge_document_tags WHERE document_id = v_doc.id
    AND tag_id <> ALL (COALESCE(p_tag_ids, '{}'));
  INSERT INTO knowledge_document_tags (user_id, document_id, tag_id)
    SELECT v_owner, v_doc.id, t FROM unnest(COALESCE(p_tag_ids, '{}')) t
    ON CONFLICT DO NOTHING;
  PERFORM knowledge_log(v_owner, v_doc.id, 'metadata_updated', jsonb_build_object('title', v_doc.title));
  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_set_rag_enabled(p_document_id uuid, p_enabled boolean)
RETURNS public.knowledge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  UPDATE knowledge_documents SET rag_enabled = p_enabled,
    index_status = CASE WHEN p_enabled THEN (CASE WHEN index_status = 'excluded' THEN 'not_indexed' ELSE index_status END) ELSE 'excluded' END,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_document_id AND user_id = v_owner AND status <> 'deleting'
  RETURNING * INTO v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  PERFORM knowledge_log(v_owner, v_doc.id, CASE WHEN p_enabled THEN 'rag_enabled' ELSE 'rag_disabled' END, '{}'::jsonb);
  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_restore_version(p_document_id uuid, p_version_id uuid)
RETURNS public.knowledge_document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_doc knowledge_documents%ROWTYPE;
  v_source knowledge_document_versions%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_next integer;
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_doc.status IN ('archived', 'deleting') THEN RAISE EXCEPTION 'Documento no disponible'; END IF;
  SELECT * INTO v_source FROM knowledge_document_versions WHERE id = p_version_id AND document_id = v_doc.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versión inexistente'; END IF;
  IF v_source.id = v_doc.current_version_id THEN RAISE EXCEPTION 'Esa ya es la versión actual'; END IF;
  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next FROM knowledge_document_versions WHERE document_id = v_doc.id;
  INSERT INTO knowledge_document_versions (user_id, document_id, version_number, source, storage_path,
    original_filename, mime_type, file_size, content_json, content_markdown, extracted_text,
    extraction_status, page_count, content_hash, change_note, created_by)
  VALUES (v_owner, v_doc.id, v_next, 'restore', v_source.storage_path, v_source.original_filename,
    v_source.mime_type, v_source.file_size, v_source.content_json, v_source.content_markdown,
    v_source.extracted_text, v_source.extraction_status, v_source.page_count, v_source.content_hash,
    'Restaurada desde la versión ' || v_source.version_number, auth.uid())
  RETURNING * INTO v_version;
  UPDATE knowledge_documents SET current_version_id = v_version.id,
    draft_content = CASE WHEN kind = 'editor' THEN v_source.content_json ELSE draft_content END,
    draft_revision = CASE WHEN kind = 'editor' THEN draft_revision + 1 ELSE draft_revision END,
    search_text = left(COALESCE(v_source.extracted_text, ''), 100000),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = v_doc.id;
  PERFORM knowledge_log(v_owner, v_doc.id, 'version_restored',
    jsonb_build_object('from_version', v_source.version_number, 'new_version', v_next));
  RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_register_asset(p_document_id uuid, p_storage_path text, p_mime_type text, p_file_size bigint)
RETURNS public.knowledge_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('write');
  v_asset knowledge_assets%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner AND status NOT IN ('archived', 'deleting')) THEN
    RAISE EXCEPTION 'Documento no disponible';
  END IF;
  IF p_storage_path !~ ('^' || v_owner::text || '/' || p_document_id::text || '/assets/[0-9a-f-]{36}\.(webp|png|jpg)$') THEN
    RAISE EXCEPTION 'Ruta de imagen inválida';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || v_owner::text, 0));
  IF knowledge_storage_used(v_owner) + p_file_size > 1073741824 THEN
    RAISE EXCEPTION 'Se alcanzó el límite de 1 GB de almacenamiento';
  END IF;
  INSERT INTO knowledge_assets (user_id, document_id, storage_path, mime_type, file_size)
  VALUES (v_owner, p_document_id, p_storage_path, p_mime_type, p_file_size)
  RETURNING * INTO v_asset;
  RETURN v_asset;
END;
$$;

-- Two-step deletion: the client removes Storage objects between both calls
-- (Supabase does not allow deleting Storage objects from SQL).
CREATE OR REPLACE FUNCTION public.knowledge_prepare_delete(p_document_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('delete');
  v_doc knowledge_documents%ROWTYPE;
  v_paths text[];
BEGIN
  SELECT * INTO v_doc FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento inexistente'; END IF;
  IF v_doc.status <> 'deleting' THEN
    UPDATE knowledge_documents SET status = 'deleting', rag_enabled = false, index_status = 'excluded',
      updated_at = now(), updated_by = auth.uid()
    WHERE id = v_doc.id;
    PERFORM knowledge_log(v_owner, v_doc.id, 'delete_started', jsonb_build_object('title', v_doc.title));
  END IF;
  SELECT COALESCE(array_agg(DISTINCT p), '{}') INTO v_paths FROM (
    SELECT storage_path AS p FROM knowledge_document_versions WHERE document_id = v_doc.id AND storage_path IS NOT NULL
    UNION SELECT storage_path FROM knowledge_assets WHERE document_id = v_doc.id
  ) paths;
  RETURN v_paths;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_finalize_delete(p_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('delete');
  v_title text;
BEGIN
  SELECT title INTO v_title FROM knowledge_documents
   WHERE id = p_document_id AND user_id = v_owner AND status = 'deleting' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Primero hay que preparar la eliminación'; END IF;
  DELETE FROM knowledge_documents WHERE id = p_document_id AND user_id = v_owner;
  PERFORM knowledge_log(v_owner, p_document_id, 'deleted', jsonb_build_object('title', v_title));
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_search_documents(
  p_query text DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL,
  p_include_subfolders boolean DEFAULT true,
  p_category_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_formats text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_index_statuses text[] DEFAULT NULL,
  p_updated_from timestamptz DEFAULT NULL,
  p_updated_to timestamptz DEFAULT NULL,
  p_sort text DEFAULT 'updated_desc',
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
  v_query tsquery;
  v_result jsonb;
BEGIN
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  p_offset := GREATEST(COALESCE(p_offset, 0), 0);
  IF p_query IS NOT NULL AND btrim(p_query) <> '' THEN
    v_query := websearch_to_tsquery('spanish', kb_unaccent(left(p_query, 200)));
  END IF;

  WITH RECURSIVE folder_scope AS (
    SELECT id FROM knowledge_folders WHERE p_folder_id IS NOT NULL AND id = p_folder_id AND user_id = v_owner
    UNION ALL
    SELECT f.id FROM knowledge_folders f JOIN folder_scope s ON f.parent_id = s.id
    WHERE p_include_subfolders AND f.user_id = v_owner
  ),
  filtered AS (
    SELECT d.*, CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank_cd(d.search_tsv, v_query) END AS rank
    FROM knowledge_documents d
    WHERE d.user_id = v_owner AND d.status <> 'deleting'
      AND (v_query IS NULL OR d.search_tsv @@ v_query)
      AND (p_folder_id IS NULL OR d.folder_id IN (SELECT id FROM folder_scope))
      AND (p_category_id IS NULL OR d.category_id = p_category_id)
      AND (p_formats IS NULL OR cardinality(p_formats) = 0 OR d.format = ANY (p_formats))
      AND (p_statuses IS NULL OR cardinality(p_statuses) = 0 OR d.status = ANY (p_statuses))
      AND (p_index_statuses IS NULL OR cardinality(p_index_statuses) = 0 OR d.index_status = ANY (p_index_statuses))
      AND (p_updated_from IS NULL OR d.updated_at >= p_updated_from)
      AND (p_updated_to IS NULL OR d.updated_at < p_updated_to)
      AND (p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0 OR EXISTS (
            SELECT 1 FROM knowledge_document_tags t WHERE t.document_id = d.id AND t.tag_id = ANY (p_tag_ids)))
  ),
  ordered AS (
    SELECT f.*, row_number() OVER (ORDER BY
        CASE WHEN p_sort = 'relevance' AND v_query IS NOT NULL THEN f.rank END DESC NULLS LAST,
        CASE WHEN p_sort = 'title_asc' THEN lower(f.title) END ASC,
        CASE WHEN p_sort = 'updated_asc' THEN f.updated_at END ASC,
        f.updated_at DESC, f.id) AS ord
    FROM filtered f
  ),
  page AS (
    SELECT * FROM ordered WHERE ord > p_offset AND ord <= p_offset + p_limit
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'format', p.format, 'title', p.title, 'description', p.description,
        'folder_id', p.folder_id, 'category_id', p.category_id, 'status', p.status,
        'rag_enabled', p.rag_enabled, 'index_status', p.index_status, 'index_error', p.index_error,
        'current_version_id', p.current_version_id, 'published_version_id', p.published_version_id,
        'has_unpublished_changes', (p.published_version_id IS NOT NULL AND p.current_version_id IS DISTINCT FROM p.published_version_id),
        'created_at', p.created_at, 'updated_at', p.updated_at, 'published_at', p.published_at,
        'tag_ids', COALESCE((SELECT jsonb_agg(t.tag_id) FROM knowledge_document_tags t WHERE t.document_id = p.id), '[]'::jsonb),
        'snippet', CASE WHEN v_query IS NULL THEN NULL ELSE ts_headline('spanish', left(p.search_text, 5000), v_query,
          'MaxWords=28, MinWords=12, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … ", StartSel=«, StopSel=»') END
      ) ORDER BY p.ord) FROM page p), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.knowledge_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := knowledge_require_owner('read');
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'documents', count(*) FILTER (WHERE status <> 'deleting'),
      'draft', count(*) FILTER (WHERE status = 'draft'),
      'in_review', count(*) FILTER (WHERE status = 'in_review'),
      'published', count(*) FILTER (WHERE status = 'published'),
      'archived', count(*) FILTER (WHERE status = 'archived'),
      'deleting', count(*) FILTER (WHERE status = 'deleting'),
      'index_queued', count(*) FILTER (WHERE index_status = 'queued'),
      'index_processing', count(*) FILTER (WHERE index_status = 'processing'),
      'index_ready', count(*) FILTER (WHERE index_status = 'ready'),
      'index_error', count(*) FILTER (WHERE index_status = 'error'),
      'available_to_ai', count(*) FILTER (WHERE status = 'published' AND rag_enabled AND index_status = 'ready'),
      'chunks', COALESCE(sum(chunk_count), 0),
      'last_updated_at', max(updated_at),
      'last_indexed_at', max(last_indexed_at),
      'storage_bytes', knowledge_storage_used(v_owner),
      'storage_limit_bytes', 1073741824
    )
    FROM knowledge_documents WHERE user_id = v_owner
  );
END;
$$;

-- Moves a legacy knowledge/ file from ai_workspace_files into Knowledge.
-- Skills (skills/...) are never touched.
CREATE OR REPLACE FUNCTION public.knowledge_import_workspace_file(p_workspace_file_id uuid)
RETURNS public.knowledge_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_file ai_workspace_files%ROWTYPE;
  v_doc knowledge_documents%ROWTYPE;
  v_version knowledge_document_versions%ROWTYPE;
  v_format text;
  v_title text;
BEGIN
  IF v_owner IS NULL OR EXISTS (SELECT 1 FROM collaborators WHERE user_uid = v_owner AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Solo el propietario puede migrar la biblioteca';
  END IF;
  SELECT * INTO v_file FROM ai_workspace_files WHERE id = p_workspace_file_id AND user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Archivo inexistente'; END IF;
  IF v_file.path NOT LIKE 'knowledge/%' THEN RAISE EXCEPTION 'Solo se migran documentos de knowledge/'; END IF;
  IF btrim(v_file.content) = '' THEN RAISE EXCEPTION 'El archivo está vacío'; END IF;
  v_format := CASE WHEN v_file.path ~* '\.md$' THEN 'md' ELSE 'txt' END;
  v_title := initcap(replace(replace(regexp_replace(v_file.path, '^.*/|\.[A-Za-z0-9]+$', '', 'g'), '-', ' '), '_', ' '));
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge:' || v_owner::text, 0));
  IF (SELECT count(*) FROM knowledge_documents WHERE user_id = v_owner) >= 2000 THEN
    RAISE EXCEPTION 'Se alcanzó el máximo de 2000 documentos';
  END IF;

  INSERT INTO knowledge_documents (user_id, kind, format, title, description, status, created_by, updated_by)
  VALUES (v_owner, 'file', v_format, left(v_title, 160), 'Migrado desde la Biblioteca (' || v_file.path || ')',
    'draft', v_owner, v_owner)
  RETURNING * INTO v_doc;
  INSERT INTO knowledge_document_versions (user_id, document_id, version_number, source, content_markdown,
    extracted_text, extraction_status, content_hash, change_note, created_by)
  VALUES (v_owner, v_doc.id, 1, 'import', v_file.content, v_file.content, 'done',
    encode(sha256(convert_to(v_file.content, 'UTF8')), 'hex'), 'Importado desde ' || v_file.path, v_owner)
  RETURNING * INTO v_version;
  -- It was already used as approved knowledge, so it keeps that role.
  UPDATE knowledge_documents SET current_version_id = v_version.id, published_version_id = v_version.id,
    status = 'published', published_at = now(), search_text = left(v_file.content, 100000)
  WHERE id = v_doc.id RETURNING * INTO v_doc;
  DELETE FROM ai_workspace_files WHERE id = v_file.id;
  PERFORM knowledge_log(v_owner, v_doc.id, 'imported', jsonb_build_object('path', v_file.path));
  RETURN v_doc;
END;
$$;

-- ───────────────────────── Grants ─────────────────────────
REVOKE ALL ON FUNCTION
  public.knowledge_owner_for(text), public.knowledge_require_owner(text), public.knowledge_folders_guard(),
  public.knowledge_log(uuid, uuid, text, jsonb), public.knowledge_mime_allowed(text, text),
  public.knowledge_storage_used(uuid),
  public.knowledge_create_document(text, text, text, text, uuid, uuid),
  public.knowledge_add_file_version(uuid, text, text, text, bigint, text, text, text),
  public.knowledge_save_draft(uuid, jsonb, integer),
  public.knowledge_save_editor_version(uuid, jsonb, text, text, text, integer, text),
  public.knowledge_set_status(uuid, text, text),
  public.knowledge_update_metadata(uuid, text, text, uuid, uuid, uuid[]),
  public.knowledge_set_rag_enabled(uuid, boolean),
  public.knowledge_restore_version(uuid, uuid),
  public.knowledge_register_asset(uuid, text, text, bigint),
  public.knowledge_prepare_delete(uuid), public.knowledge_finalize_delete(uuid),
  public.knowledge_search_documents(text, uuid, boolean, uuid, uuid[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer),
  public.knowledge_stats(), public.knowledge_import_workspace_file(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.knowledge_owner_for(text),
  public.knowledge_create_document(text, text, text, text, uuid, uuid),
  public.knowledge_add_file_version(uuid, text, text, text, bigint, text, text, text),
  public.knowledge_save_draft(uuid, jsonb, integer),
  public.knowledge_save_editor_version(uuid, jsonb, text, text, text, integer, text),
  public.knowledge_set_status(uuid, text, text),
  public.knowledge_update_metadata(uuid, text, text, uuid, uuid, uuid[]),
  public.knowledge_set_rag_enabled(uuid, boolean),
  public.knowledge_restore_version(uuid, uuid),
  public.knowledge_register_asset(uuid, text, text, bigint),
  public.knowledge_prepare_delete(uuid), public.knowledge_finalize_delete(uuid),
  public.knowledge_search_documents(text, uuid, boolean, uuid, uuid[], text[], text[], text[], timestamptz, timestamptz, text, integer, integer),
  public.knowledge_stats(), public.knowledge_import_workspace_file(uuid)
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

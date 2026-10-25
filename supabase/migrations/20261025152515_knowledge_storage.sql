BEGIN;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('knowledge', 'knowledge', false, 52428800, ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown', 'text/x-markdown',
  'image/png', 'image/jpeg', 'image/webp'
])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Path layout: <owner_uid>/<document_id>/v<N>/<file> and <owner_uid>/<document_id>/assets/<uuid>.<ext>
CREATE POLICY knowledge_objects_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = (SELECT public.knowledge_owner_for('read'))::text);
CREATE POLICY knowledge_objects_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = (SELECT public.knowledge_owner_for('write'))::text);
CREATE POLICY knowledge_objects_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] = (SELECT public.knowledge_owner_for('delete'))::text);
-- No UPDATE policy: objects are immutable (no upsert).
COMMIT;

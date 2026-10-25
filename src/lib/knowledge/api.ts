import { supabase } from '../supabase';
import { detectFormat, MAX_FILE_BYTES, readTextIfPlain } from './files';
import { sha256Hex } from './hash';
import { knowledgeContentTypeFor, removePaths, uploadVersionFile } from './storage';
import type {
  KnowledgeCategory,
  KnowledgeDocument,
  KnowledgeEvent,
  KnowledgeFolder,
  KnowledgeFormat,
  KnowledgeSearchFilters,
  KnowledgeSearchResult,
  KnowledgeStats,
  KnowledgeStatus,
  KnowledgeTag,
  KnowledgeVersion,
} from './types';

type RpcArgs = Record<string, unknown>;
type RpcError = { message: string };
const dynamicRpc = supabase.rpc as unknown as (
  functionName: string,
  args?: RpcArgs,
) => Promise<{ data: unknown; error: RpcError | null }>;

async function rpc<T>(functionName: string, args: RpcArgs = {}): Promise<T> {
  const { data, error } = await dynamicRpc(functionName, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function ownerUid(action: 'read' | 'write' | 'delete' = 'write'): Promise<string> {
  return rpc<string>('knowledge_owner_for', { p_action: action });
}

function throwQueryError(error: RpcError | null): void {
  if (error) throw new Error(error.message);
}

export async function searchDocuments(filters: KnowledgeSearchFilters = {}): Promise<KnowledgeSearchResult> {
  return rpc<KnowledgeSearchResult>('knowledge_search_documents', {
    p_query: filters.query?.trim() || null,
    p_folder_id: filters.folderId ?? null,
    p_include_subfolders: filters.includeSubfolders ?? true,
    p_category_id: filters.categoryId ?? null,
    p_tag_ids: filters.tagIds?.length ? filters.tagIds : null,
    p_formats: filters.formats?.length ? filters.formats : null,
    p_statuses: filters.statuses?.length ? filters.statuses : null,
    p_index_statuses: filters.indexStatuses?.length ? filters.indexStatuses : null,
    p_updated_from: filters.updatedFrom ?? null,
    p_updated_to: filters.updatedTo ?? null,
    p_sort: filters.sort ?? 'updated_desc',
    p_limit: filters.limit ?? 30,
    p_offset: filters.offset ?? 0,
  });
}

export async function getStats(): Promise<KnowledgeStats> {
  return rpc<KnowledgeStats>('knowledge_stats');
}

export async function getDocument(documentId: string): Promise<KnowledgeDocument> {
  const { data, error } = await supabase.from('knowledge_documents').select('*').eq('id', documentId).maybeSingle();
  throwQueryError(error);
  if (!data) throw new Error('Documento inexistente.');
  return data as unknown as KnowledgeDocument;
}

export async function listDeletingDocuments(): Promise<KnowledgeDocument[]> {
  const { data, error } = await supabase.from('knowledge_documents').select('*')
    .eq('status', 'deleting').order('updated_at', { ascending: false });
  throwQueryError(error);
  return (data ?? []) as unknown as KnowledgeDocument[];
}

export async function getCategoryDocumentCount(categoryId: string): Promise<number> {
  const { count, error } = await supabase.from('knowledge_documents').select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId).neq('status', 'deleting');
  throwQueryError(error);
  return count ?? 0;
}

export async function getTagDocumentCount(tagId: string): Promise<number> {
  const { count, error } = await supabase.from('knowledge_document_tags').select('document_id', { count: 'exact', head: true })
    .eq('tag_id', tagId);
  throwQueryError(error);
  return count ?? 0;
}

export async function listVersions(documentId: string): Promise<KnowledgeVersion[]> {
  const { data, error } = await supabase.from('knowledge_document_versions')
    .select('*').eq('document_id', documentId).order('version_number', { ascending: false });
  throwQueryError(error);
  return (data ?? []) as unknown as KnowledgeVersion[];
}

export async function listEvents(documentId?: string, limit = 200): Promise<KnowledgeEvent[]> {
  let query = supabase.from('knowledge_events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (documentId) query = query.eq('document_id', documentId);
  const { data, error } = await query;
  throwQueryError(error);
  return (data ?? []) as unknown as KnowledgeEvent[];
}

export async function listFolders(): Promise<KnowledgeFolder[]> {
  const { data, error } = await supabase.from('knowledge_folders').select('*')
    .order('position', { ascending: true }).order('name', { ascending: true });
  throwQueryError(error);
  return (data ?? []) as unknown as KnowledgeFolder[];
}

export async function listCategories(): Promise<KnowledgeCategory[]> {
  const { data, error } = await supabase.from('knowledge_categories').select('*').order('name', { ascending: true });
  throwQueryError(error);
  return (data ?? []) as unknown as KnowledgeCategory[];
}

export async function listTags(): Promise<KnowledgeTag[]> {
  const { data, error } = await supabase.from('knowledge_tags').select('*').order('name', { ascending: true });
  throwQueryError(error);
  return (data ?? []) as unknown as KnowledgeTag[];
}

export async function listDocumentTagIds(documentId: string): Promise<string[]> {
  const { data, error } = await supabase.from('knowledge_document_tags').select('tag_id').eq('document_id', documentId);
  throwQueryError(error);
  return (data ?? []).map((row) => (row as unknown as { tag_id: string }).tag_id);
}

export async function createFolder(name: string, parentId: string | null = null): Promise<KnowledgeFolder> {
  const { data, error } = await supabase.from('knowledge_folders')
    .insert({ user_id: await ownerUid(), name: name.trim(), parent_id: parentId })
    .select('*').single();
  throwQueryError(error);
  return data as unknown as KnowledgeFolder;
}

export async function updateFolder(folderId: string, values: { name?: string; parentId?: string | null; position?: number }): Promise<KnowledgeFolder> {
  const patch: Record<string, unknown> = {};
  if (values.name !== undefined) patch.name = values.name.trim();
  if (values.parentId !== undefined) patch.parent_id = values.parentId;
  if (values.position !== undefined) patch.position = values.position;
  const { data, error } = await supabase.from('knowledge_folders').update(patch).eq('id', folderId).select('*').single();
  throwQueryError(error);
  return data as unknown as KnowledgeFolder;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const { error } = await supabase.from('knowledge_folders').delete().eq('id', folderId);
  throwQueryError(error);
}

export async function createCategory(name: string, color: KnowledgeCategory['color'] = 'slate'): Promise<KnowledgeCategory> {
  const { data, error } = await supabase.from('knowledge_categories')
    .insert({ user_id: await ownerUid(), name: name.trim(), color }).select('*').single();
  throwQueryError(error);
  return data as unknown as KnowledgeCategory;
}

export async function updateCategory(categoryId: string, values: { name?: string; color?: KnowledgeCategory['color'] }): Promise<KnowledgeCategory> {
  const patch: Record<string, unknown> = {};
  if (values.name !== undefined) patch.name = values.name.trim();
  if (values.color !== undefined) patch.color = values.color;
  const { data, error } = await supabase.from('knowledge_categories').update(patch)
    .eq('id', categoryId).select('*').single();
  throwQueryError(error);
  return data as unknown as KnowledgeCategory;
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const { error } = await supabase.from('knowledge_categories').delete().eq('id', categoryId);
  throwQueryError(error);
}

export async function createTag(name: string): Promise<KnowledgeTag> {
  const { data, error } = await supabase.from('knowledge_tags')
    .insert({ user_id: await ownerUid(), name: name.trim() }).select('*').single();
  throwQueryError(error);
  return data as unknown as KnowledgeTag;
}

export async function renameTag(tagId: string, name: string): Promise<KnowledgeTag> {
  const { data, error } = await supabase.from('knowledge_tags').update({ name: name.trim() })
    .eq('id', tagId).select('*').single();
  throwQueryError(error);
  return data as unknown as KnowledgeTag;
}

export async function deleteTag(tagId: string): Promise<void> {
  const { error } = await supabase.from('knowledge_tags').delete().eq('id', tagId);
  throwQueryError(error);
}

export async function createDocument(
  format: KnowledgeFormat,
  title: string,
  options: { kind?: 'file' | 'editor'; description?: string; folderId?: string | null; categoryId?: string | null } = {},
): Promise<KnowledgeDocument> {
  return rpc<KnowledgeDocument>('knowledge_create_document', {
    p_kind: options.kind ?? 'file',
    p_format: format,
    p_title: title,
    p_description: options.description ?? '',
    p_folder_id: options.folderId ?? null,
    p_category_id: options.categoryId ?? null,
  });
}

export async function addFileVersion(
  documentId: string,
  storagePath: string,
  originalFilename: string,
  mimeType: string,
  fileSize: number,
  contentHash: string,
  extractedText: string | null = null,
  changeNote = '',
): Promise<KnowledgeVersion> {
  return rpc<KnowledgeVersion>('knowledge_add_file_version', {
    p_document_id: documentId,
    p_storage_path: storagePath,
    p_original_filename: originalFilename,
    p_mime_type: mimeType,
    p_file_size: fileSize,
    p_content_hash: contentHash,
    p_extracted_text: extractedText,
    p_change_note: changeNote,
  });
}

export async function uploadNewFileVersion(documentId: string, file: File, changeNote = ''): Promise<KnowledgeVersion> {
  const document = await getDocument(documentId);
  if (document.kind !== 'file') throw new Error('Este documento se edita con el editor.');
  if (document.status === 'archived' || document.status === 'deleting') throw new Error('Restaurá el documento antes de agregar versiones.');
  if (detectFormat(file) !== document.format) throw new Error('El archivo debe mantener el mismo formato que el documento.');
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error('El archivo debe pesar entre 1 byte y 50 MB.');

  const versions = await listVersions(documentId);
  const nextNumber = Math.max(0, ...versions.map((version) => version.version_number)) + 1;
  const storagePath = await uploadVersionFile(await ownerUid(), documentId, nextNumber, file);
  try {
    const [contentHash, extractedText] = await Promise.all([sha256Hex(await file.arrayBuffer()), readTextIfPlain(file)]);
    return await addFileVersion(documentId, storagePath, file.name, knowledgeContentTypeFor(file), file.size, contentHash, extractedText, changeNote);
  } catch (error) {
    try {
      await removePaths([storagePath]);
    } catch (cleanupError) {
      throw new Error(`${errorMessage(error)} No se pudo borrar el archivo temporal: ${errorMessage(cleanupError)}`);
    }
    throw error;
  }
}

export async function saveDraft(documentId: string, content: Record<string, unknown>, expectedRevision: number): Promise<{ draft_revision: number; draft_updated_at: string }> {
  return rpc('knowledge_save_draft', {
    p_document_id: documentId, p_content: content, p_expected_revision: expectedRevision,
  });
}

export async function saveEditorVersion(
  documentId: string,
  contentJson: Record<string, unknown>,
  contentMarkdown: string,
  plainText: string,
  contentHash: string,
  expectedRevision: number,
  changeNote = '',
): Promise<KnowledgeVersion> {
  return rpc<KnowledgeVersion>('knowledge_save_editor_version', {
    p_document_id: documentId,
    p_content_json: contentJson,
    p_content_markdown: contentMarkdown,
    p_plain_text: plainText,
    p_content_hash: contentHash,
    p_expected_revision: expectedRevision,
    p_change_note: changeNote,
  });
}

export async function setStatus(documentId: string, status: KnowledgeStatus, note = ''): Promise<KnowledgeDocument> {
  return rpc<KnowledgeDocument>('knowledge_set_status', { p_document_id: documentId, p_status: status, p_note: note });
}

export async function updateMetadata(
  documentId: string,
  values: { title: string; description: string; folderId: string | null; categoryId: string | null; tagIds: string[] },
): Promise<KnowledgeDocument> {
  return rpc<KnowledgeDocument>('knowledge_update_metadata', {
    p_document_id: documentId,
    p_title: values.title,
    p_description: values.description,
    p_folder_id: values.folderId,
    p_category_id: values.categoryId,
    p_tag_ids: values.tagIds,
  });
}

export async function setRagEnabled(documentId: string, enabled: boolean): Promise<KnowledgeDocument> {
  return rpc<KnowledgeDocument>('knowledge_set_rag_enabled', { p_document_id: documentId, p_enabled: enabled });
}

export async function reindexDocument(documentId: string): Promise<void> {
  await rpc<null>('knowledge_reindex_document', { p_document_id: documentId });
}

export async function restoreVersion(documentId: string, versionId: string): Promise<KnowledgeVersion> {
  return rpc<KnowledgeVersion>('knowledge_restore_version', { p_document_id: documentId, p_version_id: versionId });
}

export async function registerAsset(documentId: string, storagePath: string, mimeType: string, fileSize: number) {
  return rpc<{ id: string; user_id: string; document_id: string; storage_path: string; mime_type: string; file_size: number; created_at: string }>(
    'knowledge_register_asset', {
      p_document_id: documentId, p_storage_path: storagePath, p_mime_type: mimeType, p_file_size: fileSize,
    },
  );
}

export async function prepareDelete(documentId: string): Promise<string[]> {
  return rpc<string[]>('knowledge_prepare_delete', { p_document_id: documentId });
}

export async function finalizeDelete(documentId: string): Promise<void> {
  await rpc<null>('knowledge_finalize_delete', { p_document_id: documentId });
}

export async function deleteDocument(documentId: string): Promise<void> {
  const paths = await prepareDelete(documentId);
  try {
    await removePaths(paths);
  } catch {
    throw new Error('No se pudieron borrar los archivos. Reintentá desde Administración.');
  }
  await finalizeDelete(documentId);
}

export async function importWorkspaceFile(workspaceFileId: string): Promise<KnowledgeDocument> {
  return rpc<KnowledgeDocument>('knowledge_import_workspace_file', { p_workspace_file_id: workspaceFileId });
}

export interface UploadProgress {
  name: string;
  index: number;
  total: number;
  stage: 'queued' | 'uploading' | 'registering' | 'ready' | 'error';
  error?: string;
}

export interface UploadDocumentsOptions {
  folderId?: string | null;
  categoryId?: string | null;
  tagIds?: string[];
  publish?: boolean;
}

export interface UploadDocumentsResult {
  ok: KnowledgeDocument[];
  failed: { name: string; error: string }[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
}

export async function uploadDocuments(
  files: File[],
  options: UploadDocumentsOptions = {},
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadDocumentsResult> {
  const ok: KnowledgeDocument[] = [];
  const failed: UploadDocumentsResult['failed'] = [];
  const total = files.length;
  const processable = files.slice(0, 20);
  const emitProgress = (event: UploadProgress) => {
    try { onProgress?.(event); } catch { /* UI callbacks must not interrupt a storage transaction. */ }
  };

  for (const [index, file] of processable.entries()) {
    const progress = (stage: UploadProgress['stage'], error?: string) => emitProgress({
      name: file.name, index: index + 1, total, stage, ...(error ? { error } : {}),
    });
    let document: KnowledgeDocument | null = null;
    let storagePath: string | null = null;
    let versionRegistered = false;
    try {
      const format = detectFormat(file);
      if (!format) throw new Error('Formato de archivo no permitido.');
      if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error('El archivo debe pesar entre 1 byte y 50 MB.');
      progress('queued');
      const title = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 160) || 'Documento';
      document = await createDocument(format, title, { folderId: options.folderId, categoryId: options.categoryId });
      progress('uploading');
      const owner = await ownerUid();
      storagePath = await uploadVersionFile(owner, document.id, 1, file);
      progress('registering');
      const [contentHash, extractedText] = await Promise.all([sha256Hex(await file.arrayBuffer()), readTextIfPlain(file)]);
      await addFileVersion(document.id, storagePath, file.name, knowledgeContentTypeFor(file), file.size, contentHash, extractedText);
      versionRegistered = true;

      if (options.tagIds?.length) {
        await updateMetadata(document.id, {
          title: document.title,
          description: document.description,
          folderId: document.folder_id,
          categoryId: document.category_id,
          tagIds: options.tagIds,
        });
      }
      if (options.publish) await setStatus(document.id, 'published');
      const saved = await getDocument(document.id);
      ok.push(saved);
      progress('ready');
    } catch (error) {
      let message = errorMessage(error);
      if (document && !versionRegistered) {
        try {
          const paths = await prepareDelete(document.id);
          await removePaths(storagePath ? [...paths, storagePath] : paths);
          await finalizeDelete(document.id);
        } catch {
          // Leave the record in deleting so the Administration screen can retry cleanup.
        }
      } else if (document && versionRegistered) {
        try {
          ok.push(await getDocument(document.id));
          message = `El archivo se cargó, pero no se completó una acción posterior: ${message}`;
        } catch {
          message = `El archivo se registró, pero no se pudo confirmar su estado: ${message}`;
        }
      }
      failed.push({ name: file.name, error: message });
      progress('error', message);
    }
  }

  for (const [index, file] of files.slice(20).entries()) {
    const message = 'Máximo 20 archivos por carga.';
    failed.push({ name: file.name, error: message });
    emitProgress({ name: file.name, index: index + 21, total, stage: 'error', error: message });
  }
  return { ok, failed };
}

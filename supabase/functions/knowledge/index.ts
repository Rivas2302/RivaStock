import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authorizeWorker, isUuid, jsonResponse, readJsonLimited } from '../_shared/workerAuth.ts';
import {
  memoryWorkerPayload,
  validateCentralWorkerAction,
  validateMemoryWorkerAction,
  validateWorkerRetrieveRequest,
  type CentralWorkerAction,
} from './contract.ts';
import { createSupabaseApiKeyFetch, withSupabaseAdminKeyMode, resolveSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';
import { createProductionSupabaseS3Storage } from '../_shared/supabaseS3Storage.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const storageAdmin = createProductionSupabaseS3Storage(SUPABASE_URL);
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
);
const MAX_BODY_BYTES = 1_048_576;
const CENTRAL_ACTIONS = new Set<CentralWorkerAction>([
  'worker_central_next', 'worker_central_stored', 'worker_central_inventory', 'worker_central_inventory_list',
  'worker_central_purge', 'worker_central_deletions', 'worker_central_deletions_done',
  'worker_central_status', 'worker_central_local_file', 'worker_central_requests',
  'worker_central_request_ready', 'worker_central_request_failed', 'worker_central_cache_cleanup',
]);

const ACTIONS = {
  worker_next: 'next',
  worker_job_heartbeat: 'job_heartbeat',
  worker_extracted_text: 'extracted_text',
  worker_submit_chunks: 'submit_chunks',
  worker_complete: 'complete',
  worker_fail: 'fail',
  worker_search_result: 'search_result',
  worker_search_fail: 'search_fail',
  worker_memory_retrieve: 'retrieve',
  worker_memory_similar: 'similar',
  worker_memory_apply: 'apply',
  worker_memory_metric: 'metric',
  worker_memory_finish: 'finish',
  worker_memory_chat_summary: 'chat_summary',
  worker_memory_chat_index: 'chat_index',
  worker_memory_idle_summary_candidates: 'idle_summary_candidates',
  worker_memory_pending_embeddings: 'pending_embeddings',
  worker_memory_store_embeddings: 'store_embeddings',
} as const;

type WorkerAction = keyof typeof ACTIONS | 'worker_file_url' | 'worker_organize_images' | 'worker_retrieve' | 'worker_memory_touch_similar';
type KnowledgeAction = WorkerAction | CentralWorkerAction;
type Body = Record<string, unknown>;
const CENTRAL_PATH_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[0-9]{1,5}\/[A-Za-z0-9._-]{1,120}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 384
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isModel(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 120;
}

function validateAction(action: KnowledgeAction, body: Body): string | null {
  if (action.startsWith('worker_memory_')) {
    return validateMemoryWorkerAction(action as Parameters<typeof validateMemoryWorkerAction>[0], body);
  }
  if (action.startsWith('worker_central_')) return validateCentralWorkerAction(action as CentralWorkerAction, body);
  switch (action) {
    case 'worker_next':
      return null;
    case 'worker_file_url':
    case 'worker_job_heartbeat':
    case 'worker_organize_images':
      return isUuid(body.job_id) ? null : 'Identificador de tarea inválido.';
    case 'worker_retrieve':
      return validateWorkerRetrieveRequest(body);
    case 'worker_extracted_text':
      if (!isUuid(body.job_id)) return 'Identificador de tarea inválido.';
      if (typeof body.text !== 'string' || body.text.length > 400_000) return 'Texto extraído inválido.';
      if (body.page_count !== undefined && body.page_count !== null && !isInteger(body.page_count, 0)) {
        return 'Cantidad de páginas inválida.';
      }
      return null;
    case 'worker_submit_chunks':
      if (!isUuid(body.job_id)) return 'Identificador de tarea inválido.';
      if (!isModel(body.embedding_model)) return 'Modelo de embeddings inválido.';
      if (!Array.isArray(body.chunks) || body.chunks.length < 1 || body.chunks.length > 64) {
        return 'Lote de fragmentos inválido.';
      }
      for (const chunk of body.chunks) {
        if (!isRecord(chunk)
          || !isInteger(chunk.chunk_index, 0, 1999)
          || typeof chunk.content !== 'string' || chunk.content.length < 1 || chunk.content.length > 4000
          || (chunk.section_path !== undefined && (typeof chunk.section_path !== 'string' || chunk.section_path.length > 300))
          || (chunk.page_from !== undefined && chunk.page_from !== null && !isInteger(chunk.page_from, 1))
          || (chunk.page_to !== undefined && chunk.page_to !== null && !isInteger(chunk.page_to, 1))
          || (chunk.token_estimate !== undefined && !isInteger(chunk.token_estimate, 0))
          || typeof chunk.content_hash !== 'string' || !/^[0-9a-f]{64}$/.test(chunk.content_hash)
          || !isEmbedding(chunk.embedding)) {
          return 'Fragmento inválido.';
        }
      }
      return null;
    case 'worker_complete': {
      if (!isUuid(body.job_id)) return 'Identificador de tarea inválido.';
      if (!isInteger(body.chunk_count, 1, 2000) || !isModel(body.embedding_model)) {
        return 'Resultado de indexación inválido.';
      }
      if (body.stats !== undefined && (!isRecord(body.stats)
        || new TextEncoder().encode(JSON.stringify(body.stats)).byteLength > 4000)) {
        return 'Estadísticas de indexación inválidas.';
      }
      return null;
    }
    case 'worker_fail':
      if (typeof body.error !== 'string' || body.error.trim().length < 1 || body.error.length > 1000
        || typeof body.retryable !== 'boolean') return 'Error de tarea inválido.';
      return isUuid(body.job_id) ? null : 'Identificador de tarea inválido.';
    case 'worker_search_result':
      return isUuid(body.request_id) && isEmbedding(body.embedding) && isModel(body.model)
        ? null : 'Resultado de búsqueda inválido.';
    case 'worker_search_fail':
      return isUuid(body.request_id) && typeof body.error === 'string' && body.error.length <= 500
        ? null : 'Error de búsqueda inválido.';
  }
  return 'Acción de worker no permitida.';
}

function isCentralPath(path: unknown, ownerUid: string): path is string {
  return typeof path === 'string' && CENTRAL_PATH_PATTERN.test(path) && path.startsWith(`${ownerUid}/`)
    && !path.split('/').some((part) => part === '.' || part === '..');
}

async function centralAction(
  serviceClient: ReturnType<typeof createClient>,
  ownerUid: string,
  body: Body,
  action: CentralWorkerAction,
): Promise<Response> {
  const workerId = body.worker_id as string;
  const rpc = async (name: string, args: Record<string, unknown>) => serviceClient.rpc(name, args);
  if (action === 'worker_central_next') {
    const { data, error } = await rpc('knowledge_central_next_transfer', { p_owner: ownerUid, p_worker: workerId });
    if (error) return rpcErrorResponse(error);
    const files = Array.isArray(data) ? data : [];
    const ready = [];
    for (const value of files.slice(0, 5)) {
      if (!isRecord(value) || !isUuid(value.version_id) || !isCentralPath(value.relative_path, ownerUid)
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)
        || !isInteger(value.file_size, 1, 52_428_800)) continue;
      const { data: signed, error: signError } = await storageAdmin.from('knowledge')
        .createSignedUrl(value.relative_path, 120);
      if (signError || !signed?.signedUrl) return jsonResponse({ error: 'No se pudo preparar el original para la central.' }, 500);
      ready.push({ ...value, url: signed.signedUrl });
    }
    return jsonResponse({ files: ready });
  }

  if (action === 'worker_central_stored') {
    const { data, error } = await rpc('knowledge_central_stored', {
      p_owner: ownerUid, p_worker: workerId, p_version_id: body.version_id, p_sha256: body.sha256,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ result: data });
  }

  if (action === 'worker_central_inventory') {
    const { data, error } = await rpc('knowledge_central_inventory', {
      p_owner: ownerUid, p_worker: workerId, p_inventory: body.inventory,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ result: data });
  }

  if (action === 'worker_central_inventory_list') {
    const { data, error } = await rpc('knowledge_central_list_expected', {
      p_owner: ownerUid, p_worker: workerId, p_offset: body.offset, p_limit: body.limit,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ files: Array.isArray(data) ? data : [] });
  }

  if (action === 'worker_central_purge') {
    const { data: readyData, error: readyError } = await rpc('knowledge_central_purge_ready', { p_owner: ownerUid });
    if (readyError) return rpcErrorResponse(readyError);
    const ready = Array.isArray(readyData) ? readyData : [];
    const removedIds: string[] = [];
    for (let offset = 0; offset < ready.length; offset += 100) {
      const batch = ready.slice(offset, offset + 100);
      const valid = batch.filter((value): value is Record<string, unknown> => isRecord(value)
        && Array.isArray(value.version_ids) && value.version_ids.length > 0 && value.version_ids.length <= 1000
        && value.version_ids.every((id) => isUuid(id)) && isCentralPath(value.storage_path, ownerUid));
      if (!valid.length) continue;
      const { error: removeError } = await storageAdmin.from('knowledge')
        .remove([...new Set(valid.map((value) => value.storage_path as string))]);
      if (removeError) {
        console.error('[knowledge] Central storage purge failed.');
        return jsonResponse({ error: 'No se pudo purgar el original de la nube.' }, 500);
      }
      removedIds.push(...valid.flatMap((value) => value.version_ids as string[]));
    }
    if (!removedIds.length) return jsonResponse({ purged: 0 });
    const { data, error } = await rpc('knowledge_central_purged', {
      p_owner: ownerUid, p_worker: workerId, p_version_ids: removedIds,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ purged: data });
  }

  if (action === 'worker_central_deletions') {
    const { data, error } = await rpc('knowledge_central_deletions', { p_owner: ownerUid, p_worker: workerId });
    if (error) return rpcErrorResponse(error);
    const items = Array.isArray(data) ? data.filter((value) => isRecord(value)
      && isUuid(value.id) && isCentralPath(value.relative_path, ownerUid)) : [];
    return jsonResponse({ items });
  }

  if (action === 'worker_central_deletions_done') {
    const { data, error } = await rpc('knowledge_central_deletions_done', {
      p_owner: ownerUid, p_worker: workerId, p_ids: body.ids,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ completed: data });
  }

  if (action === 'worker_central_status') {
    const { error } = await rpc('knowledge_central_report_status', {
      p_owner: ownerUid,
      p_device: workerId,
      p_store_bytes: body.store_bytes,
      p_store_free_bytes: body.store_free_bytes ?? null,
      p_mirror_status: body.mirror_status,
      p_mirror_last_ok_at: body.mirror_last_ok_at ?? null,
      p_files_total: body.files_total,
      p_files_missing: body.files_missing,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ ok: true });
  }

  if (action === 'worker_central_requests') {
    const { data, error } = await rpc('knowledge_central_next_requests', {
      p_owner: ownerUid, p_worker: workerId, p_limit: 1,
    });
    if (error) return rpcErrorResponse(error);
    const requests = Array.isArray(data) ? data : [];
    const ready = [];
    for (const value of requests.slice(0, 1)) {
      if (!isRecord(value) || !isUuid(value.request_id) || !isUuid(value.version_id)
        || !isCentralPath(value.relative_path, ownerUid)
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)
        || !isInteger(value.file_size, 1, 52_428_800)
        || typeof value.mime_type !== 'string'
        || !['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain', 'text/markdown', 'text/x-markdown', 'image/png', 'image/jpeg', 'image/webp'].includes(value.mime_type)
        || typeof value.original_filename !== 'string') continue;

      const filename = safeCacheFilename(value.original_filename);
      const cachePath = ownerUid + '/' + value.request_id + '/' + filename;
      const capacity = await ensureKnowledgeCacheCapacity(serviceClient, ownerUid, value.request_id, value.file_size);
      if (!capacity) {
        await rpc('knowledge_central_request_failed', {
          p_owner: ownerUid, p_worker: workerId, p_request_id: value.request_id,
          p_error: 'La caché temporal de originales está llena.',
        });
        continue;
      }
      const { data: prepared, error: prepareError } = await serviceClient.from('knowledge_file_requests')
        .update({ cache_path: cachePath })
        .eq('user_id', ownerUid)
        .eq('id', value.request_id)
        .eq('status', 'uploading')
        .select('id')
        .maybeSingle();
      if (prepareError || !prepared) {
        await rpc('knowledge_central_request_failed', {
          p_owner: ownerUid, p_worker: workerId, p_request_id: value.request_id,
          p_error: 'No se pudo preparar la solicitud del original.',
        });
        continue;
      }
      const { data: signed, error: signedError } = await storageAdmin
        .from('knowledge-cache').createSignedUploadUrl(cachePath, { upsert: false });
      if (signedError || !signed?.signedUrl) {
        await rpc('knowledge_central_request_failed', {
          p_owner: ownerUid, p_worker: workerId, p_request_id: value.request_id,
          p_error: 'No se pudo preparar la carga temporal del original.',
        });
        continue;
      }
      ready.push({ ...value, cache_path: cachePath, upload_url: signed.signedUrl });
    }
    return jsonResponse({ requests: ready });
  }

  if (action === 'worker_central_request_ready') {
    const { data, error } = await rpc('knowledge_central_request_ready', {
      p_owner: ownerUid, p_worker: workerId, p_request_id: body.request_id, p_cache_path: body.cache_path,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ ready: data === true });
  }

  if (action === 'worker_central_request_failed') {
    const { data, error } = await rpc('knowledge_central_request_failed', {
      p_owner: ownerUid, p_worker: workerId, p_request_id: body.request_id,
      p_error: body.error, p_cache_path: body.cache_path ?? null,
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ failed: data === true });
  }

  if (action === 'worker_central_cache_cleanup') {
    const { data, error } = await rpc('knowledge_central_expired_requests', {
      p_owner: ownerUid, p_worker: workerId,
    });
    if (error) return rpcErrorResponse(error);
    const items = Array.isArray(data) ? data.filter((value) => isRecord(value)
      && isUuid(value.id)
      && (value.cache_path === null || value.cache_path === undefined
        || (typeof value.cache_path === 'string' && isCachePath(value.cache_path, ownerUid, value.id as string)))) : [];
    const cachePaths = items.flatMap((item) => typeof item.cache_path === 'string' ? [item.cache_path] : []);
    if (cachePaths.length) {
      const { error: removeError } = await storageAdmin.from('knowledge-cache').remove(cachePaths);
      if (removeError) {
        console.error('[knowledge] On-demand cache cleanup failed.');
        return jsonResponse({ error: 'No se pudo limpiar la caché de originales.' }, 500);
      }
    }
    const ids = items.map((item) => item.id as string);
    if (!ids.length) return jsonResponse({ cleaned: 0 });
    const { data: cleaned, error: doneError } = await rpc('knowledge_central_cache_cleanup_done', {
      p_owner: ownerUid, p_worker: workerId, p_request_ids: ids,
    });
    if (doneError) return rpcErrorResponse(doneError);
    return jsonResponse({ cleaned: cleaned });
  }

  const { data, error } = await rpc('knowledge_central_local_file', {
    p_owner: ownerUid, p_worker: workerId, p_version_id: body.version_id,
  });
  if (error) return rpcErrorResponse(error);
  if (!isRecord(data) || !isCentralPath(data.relative_path, ownerUid)
    || typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(data.sha256)) {
    return jsonResponse({ file: null });
  }
  return jsonResponse({ file: data });
}

function safeCacheFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop()?.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) ?? '';
  return base && base !== '.' && base !== '..' ? base : 'original';
}

function isCachePath(path: string, ownerUid: string, requestId: string): boolean {
  return path.startsWith(ownerUid + '/' + requestId + '/')
    && new RegExp('^' + ownerUid + '/' + requestId + '/[A-Za-z0-9._-]{1,120}$', 'i').test(path);
}

async function ensureKnowledgeCacheCapacity(
  serviceClient: ReturnType<typeof createClient>,
  ownerUid: string,
  currentRequestId: string,
  requiredBytes: number,
): Promise<boolean> {
  const maximumBytes = 100 * 1024 * 1024;
  if (!isInteger(requiredBytes, 1, 52_428_800)) return false;
  const bucket = storageAdmin.from('knowledge-cache');
  const { data: folders, error: folderError } = await bucket.list(ownerUid, {
    limit: 1000, sortBy: { column: 'created_at', order: 'asc' },
  });
  if (folderError) throw folderError;
  const files: Array<{ path: string; requestId: string; bytes: number; createdAt: string }> = [];
  for (const folder of folders ?? []) {
    if (folder.id !== null || !isUuid(folder.name)) continue;
    const { data: entries, error: listError } = await bucket.list(ownerUid + '/' + folder.name, {
      limit: 10, sortBy: { column: 'created_at', order: 'asc' },
    });
    if (listError) throw listError;
    for (const entry of entries ?? []) {
      if (entry.id === null
        || !isCachePath(ownerUid + '/' + folder.name + '/' + entry.name, ownerUid, folder.name)) continue;
      const bytes = Number(entry.metadata?.size);
      if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
      files.push({
        path: ownerUid + '/' + folder.name + '/' + entry.name,
        requestId: folder.name,
        bytes,
        createdAt: entry.created_at ?? '',
      });
    }
  }
  let usedBytes = files.reduce((total, file) => total + file.bytes, 0);
  if (usedBytes + requiredBytes <= maximumBytes) return true;
  const oldestFirst = files
    .filter((file) => file.requestId !== currentRequestId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const file of oldestFirst) {
    const { error: expireError } = await serviceClient.from('knowledge_file_requests')
      .update({ status: 'expired', expires_at: new Date().toISOString(), error: 'La copia temporal se reemplazó por un archivo más reciente.' })
      .eq('user_id', ownerUid).eq('id', file.requestId);
    if (expireError) throw expireError;
    const { error: removeError } = await bucket.remove([file.path]);
    if (removeError) throw removeError;
    const { error: clearPathError } = await serviceClient.from('knowledge_file_requests')
      .update({ cache_path: null })
      .eq('user_id', ownerUid).eq('id', file.requestId).eq('status', 'expired');
    if (clearPathError) throw clearPathError;
    usedBytes -= file.bytes;
    if (usedBytes + requiredBytes <= maximumBytes) return true;
  }
  return false;
}
function payloadFor(action: keyof typeof ACTIONS, body: Body): Body {
  if (action.startsWith('worker_memory_')) {
    return memoryWorkerPayload(action as Parameters<typeof memoryWorkerPayload>[0], body);
  }
  switch (action) {
    case 'worker_next':
    case 'worker_job_heartbeat':
      return {};
    case 'worker_extracted_text':
      return { text: body.text, page_count: body.page_count ?? null };
    case 'worker_submit_chunks':
      return { chunks: body.chunks, embedding_model: body.embedding_model };
    case 'worker_complete':
      return {
        chunk_count: body.chunk_count,
        embedding_model: body.embedding_model,
        stats: body.stats ?? {},
      };
    case 'worker_fail':
      return { error: body.error, retryable: body.retryable };
    case 'worker_search_result':
      return { request_id: body.request_id, embedding: body.embedding, model: body.model };
    case 'worker_search_fail':
      return { request_id: body.request_id, error: body.error };
  }
}

function rpcErrorResponse(error: { message?: string } | null): Response {
  const message = error?.message ?? '';
  if (message.includes('ya no está reservada') || message.includes('no está reservada por este worker')) {
    return jsonResponse({ error: 'La tarea ya no está reservada por este worker.' }, 409);
  }
  if (message.includes('Computadora desvinculada')) {
    return jsonResponse({ error: 'Computadora desvinculada.' }, 401);
  }
  if (message.includes('La búsqueda ya no está disponible')) {
    return jsonResponse({ error: 'La búsqueda ya no está disponible.' }, 409);
  }

  const validationErrors = [
    'Worker inválido',
    'Texto inválido',
    'Modelo inválido',
    'Lote de fragmentos inválido',
    'Embedding inválido',
    'Faltan fragmentos por enviar',
    'Error de tarea inválido',
    'Operación de worker no permitida',
  ];
  const validationError = validationErrors.find((known) => message.includes(known));
  if (validationError) return jsonResponse({ error: validationError }, 400);

  console.error('[knowledge] Database operation failed.');
  return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
}

async function fileUrl(
  serviceClient: ReturnType<typeof createClient>,
  ownerUid: string,
  workerId: string,
  jobId: string,
): Promise<Response> {
  const { data: job, error: jobError } = await serviceClient.from('knowledge_index_jobs')
    .select('document_id, version_id')
    .eq('id', jobId)
    .eq('user_id', ownerUid)
    .eq('worker_id', workerId)
    .eq('status', 'processing')
    .maybeSingle();
  if (jobError) {
    console.error('[knowledge] File job lookup failed.');
    return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
  }
  if (!job) return jsonResponse({ error: 'La tarea ya no está reservada por este worker.' }, 409);

  const { data: version, error: versionError } = await serviceClient.from('knowledge_document_versions')
    .select('storage_path, mime_type, file_size')
    .eq('id', job.version_id)
    .eq('document_id', job.document_id)
    .eq('user_id', ownerUid)
    .maybeSingle();
  if (versionError) {
    console.error('[knowledge] File version lookup failed.');
    return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
  }
  if (!version?.storage_path) return jsonResponse({ error: 'La tarea no tiene un archivo para descargar.' }, 409);

      const { data, error: storageError } = await storageAdmin.from('knowledge')
    .createSignedUrl(version.storage_path, 120);
  if (storageError || !data?.signedUrl) {
    console.error('[knowledge] Signed URL creation failed.');
    return jsonResponse({ error: 'No se pudo preparar el archivo para el worker.' }, 500);
  }
  return jsonResponse({ url: data.signedUrl, mime_type: version.mime_type, file_size: version.file_size });
}

async function organizeImages(
  serviceClient: ReturnType<typeof createClient>,
  ownerUid: string,
  workerId: string,
  jobId: string,
): Promise<Response> {
  const { data: job, error: jobError } = await serviceClient.from('ai_jobs')
    .select('id')
    .eq('id', jobId)
    .eq('user_id', ownerUid)
    .eq('worker_id', workerId)
    .eq('status', 'processing')
    .eq('task_type', 'knowledge_organize')
    .maybeSingle();
  if (jobError) {
    console.error('[knowledge] Organize job lookup failed.');
    return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
  }
  if (!job) return jsonResponse({ error: 'La tarea ya no está reservada por este worker.' }, 409);

  const { data: proposal, error: proposalError } = await serviceClient.from('knowledge_ai_proposals')
    .select('document_id, image_map')
    .eq('job_id', jobId)
    .eq('user_id', ownerUid)
    .maybeSingle();
  if (proposalError) {
    console.error('[knowledge] Organize proposal lookup failed.');
    return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
  }
  if (!proposal || !isRecord(proposal.image_map)) return jsonResponse({ images: [] });

  const requested = Object.entries(proposal.image_map)
    .filter(([id, image]) => /^IMG\d{1,3}$/.test(id) && isRecord(image)
      && typeof image.assetPath === 'string' && image.assetPath.length <= 400)
    .slice(0, 12)
    .map(([id, image]) => ({ id, path: (image as Record<string, unknown>).assetPath as string }));
  if (!requested.length) return jsonResponse({ images: [] });

  const { data: assets, error: assetsError } = await serviceClient.from('knowledge_assets')
    .select('storage_path, mime_type')
    .eq('user_id', ownerUid)
    .eq('document_id', proposal.document_id)
    .in('storage_path', requested.map((image) => image.path));
  if (assetsError) {
    console.error('[knowledge] Organize asset lookup failed.');
    return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
  }
  const assetsByPath = new Map((assets ?? []).map((asset) => [asset.storage_path, asset]));
  const allowed = requested.filter((image) => assetsByPath.has(image.path));
  if (!allowed.length) return jsonResponse({ images: [] });

      const { data: signed, error: signedError } = await storageAdmin.from('knowledge')
    .createSignedUrls(allowed.map((image) => image.path), 120);
  if (signedError || !signed) {
    console.error('[knowledge] Organize image URL creation failed.');
    return jsonResponse({ error: 'No se pudieron preparar las capturas para el worker.' }, 500);
  }
  const signedByPath = new Map(signed
    .filter((item) => typeof item.signedUrl === 'string')
    .map((item) => [item.path, item.signedUrl]));
  return jsonResponse({ images: allowed.flatMap((image) => {
    const asset = assetsByPath.get(image.path);
    const url = signedByPath.get(image.path);
    return asset && url ? [{ id: image.id, url, mime_type: asset.mime_type }] : [];
  }) });
}

serve(withSupabaseAdminKeyMode(async (req: Request) => {
  if (req.headers.has('origin')) return jsonResponse({ error: 'Esta función solo acepta conexiones del worker.' }, 403);
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  const body = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!body) return jsonResponse({ error: 'Solicitud inválida o demasiado grande.' }, 413);
  if (typeof body.action !== 'string' || (!Object.hasOwn(ACTIONS, body.action)
    && body.action !== 'worker_file_url' && body.action !== 'worker_organize_images'
    && body.action !== 'worker_retrieve' && body.action !== 'worker_memory_touch_similar'
    && !CENTRAL_ACTIONS.has(body.action as CentralWorkerAction))) {
    return jsonResponse({ error: 'Acción de worker no permitida.' }, 400);
  }
  const action = body.action as KnowledgeAction;
  if (!isUuid(body.worker_id)) return jsonResponse({ error: 'Identificador de worker inválido.' }, 400);
  if (!SUPABASE_URL || !SUPABASE_ADMIN_KEY) {
    return jsonResponse({ error: 'La función de Conocimientos no está configurada.' }, 503);
  }

  const validationError = validateAction(action, body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY) },
  });
  const ownerUid = await authorizeWorker(req, body, serviceClient);
  if (!ownerUid) return jsonResponse({ error: 'Conexión del AI Bridge inválida, vencida o desvinculada.' }, 401);

  try {
    if (action.startsWith('worker_central_')) {
      return await centralAction(serviceClient, ownerUid, body, action as CentralWorkerAction);
    }
    if (action === 'worker_file_url') {
      return await fileUrl(serviceClient, ownerUid, body.worker_id, body.job_id as string);
    }
    if (action === 'worker_organize_images') {
      return await organizeImages(serviceClient, ownerUid, body.worker_id, body.job_id as string);
    }
    if (action === 'worker_retrieve') {
      const { data, error } = await serviceClient.rpc('knowledge_worker_retrieve', {
        p_owner_uid: ownerUid,
        p_worker_id: body.worker_id,
        p_job_id: body.job_id,
        p_payload: { embedding: body.embedding, query: body.query, model: body.model },
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action === 'worker_memory_similar') {
      const { data, error } = await serviceClient.rpc('ai_memory_worker', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_operation: ACTIONS[action],
        p_job_id: body.job_id,
        p_payload: payloadFor(action, body),
      });
      if (error) return rpcErrorResponse(error);

      const { data: setting, error: settingError } = await serviceClient.from('ai_function_settings')
        .select('provider, model_id, reasoning_effort')
        .eq('user_id', ownerUid)
        .eq('function_key', 'ai_memory_extract')
        .maybeSingle();
      if (settingError) console.error('[knowledge] Memory extraction setting lookup failed.');
      const extractionSettings = setting?.provider === 'codex'
        && ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].includes(setting.model_id)
        && ['low', 'medium', 'high', 'xhigh'].includes(setting.reasoning_effort)
        ? { provider: 'codex', model_id: setting.model_id, reasoning_effort: setting.reasoning_effort }
        : null;
      return jsonResponse({ ...(data as Record<string, unknown>), extraction_settings: extractionSettings });
    }

    if (action === 'worker_memory_touch_similar') {
      const { data, error } = await serviceClient.rpc('ai_memory_touch_similar', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_job_id: body.job_id,
        p_ids: body.ids,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse({ touched: data });
    }

    if (action === 'worker_memory_chat_summary') {
      const { data, error } = await serviceClient.rpc('ai_memory_chat_summary', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_job_id: body.job_id,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action === 'worker_memory_chat_index') {
      const { data, error } = await serviceClient.rpc('ai_memory_chat_index', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_job_id: body.job_id,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action === 'worker_memory_idle_summary_candidates') {
      const { data, error } = await serviceClient.rpc('ai_memory_idle_summary_candidates', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_limit: body.limit ?? 1,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action === 'worker_memory_pending_embeddings') {
      const { data, error } = await serviceClient.rpc('ai_memory_pending_embeddings', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action === 'worker_memory_store_embeddings') {
      const { data, error } = await serviceClient.rpc('ai_memory_store_embeddings', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_embeddings: body.embeddings,
        p_model: body.model,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action === 'worker_memory_retrieve') {
      const { data, error } = await serviceClient.rpc('ai_memory_retrieve_relevant', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_job_id: body.job_id,
        p_payload: payloadFor(action, body),
        p_include_summaries: body.include_summaries === true,
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    if (action.startsWith('worker_memory_')) {
      const { data, error } = await serviceClient.rpc('ai_memory_worker', {
        p_owner: ownerUid,
        p_worker: body.worker_id,
        p_operation: ACTIONS[action as keyof typeof ACTIONS],
        p_job_id: action === 'worker_memory_pending_embeddings' || action === 'worker_memory_store_embeddings'
          ? null : body.job_id,
        p_payload: payloadFor(action as keyof typeof ACTIONS, body),
      });
      if (error) return rpcErrorResponse(error);
      return jsonResponse(data as Record<string, unknown>);
    }

    const { data, error } = await serviceClient.rpc('knowledge_worker', {
      p_action: ACTIONS[action as keyof typeof ACTIONS],
      p_owner_uid: ownerUid,
      p_worker_id: body.worker_id,
      p_job_id: action === 'worker_next' || action === 'worker_search_result' || action === 'worker_search_fail'
        ? null : body.job_id as string,
        p_payload: payloadFor(action as keyof typeof ACTIONS, body),
    });
    if (error) return rpcErrorResponse(error);
    return jsonResponse({ data });
  } catch {
    console.error('[knowledge] Unexpected request failure.');
    return jsonResponse({ error: 'No se pudo completar la operación de Conocimientos.' }, 500);
  }
}, SUPABASE_ADMIN_KEY_MODE));

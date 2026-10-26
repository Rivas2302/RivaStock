import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authorizeWorker, isUuid, jsonResponse, readJsonLimited } from '../_shared/workerAuth.ts';
import { memoryWorkerPayload, validateMemoryWorkerAction, validateWorkerRetrieveRequest } from './contract.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MAX_BODY_BYTES = 1_048_576;

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
  worker_memory_pending_embeddings: 'pending_embeddings',
  worker_memory_store_embeddings: 'store_embeddings',
} as const;

type WorkerAction = keyof typeof ACTIONS | 'worker_file_url' | 'worker_organize_images' | 'worker_retrieve' | 'worker_memory_touch_similar';
type Body = Record<string, unknown>;

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

function validateAction(action: WorkerAction, body: Body): string | null {
  if (action.startsWith('worker_memory_')) {
    return validateMemoryWorkerAction(action as Parameters<typeof validateMemoryWorkerAction>[0], body);
  }
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

  const { data, error: storageError } = await serviceClient.storage.from('knowledge')
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

  const { data: signed, error: signedError } = await serviceClient.storage.from('knowledge')
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

serve(async (req: Request) => {
  if (req.headers.has('origin')) return jsonResponse({ error: 'Esta función solo acepta conexiones del worker.' }, 403);
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido.' }, 405);

  const body = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!body) return jsonResponse({ error: 'Solicitud inválida o demasiado grande.' }, 413);
  if (typeof body.action !== 'string' || (!Object.hasOwn(ACTIONS, body.action)
    && body.action !== 'worker_file_url' && body.action !== 'worker_organize_images'
    && body.action !== 'worker_retrieve' && body.action !== 'worker_memory_touch_similar')) {
    return jsonResponse({ error: 'Acción de worker no permitida.' }, 400);
  }
  const action = body.action as WorkerAction;
  if (!isUuid(body.worker_id)) return jsonResponse({ error: 'Identificador de worker inválido.' }, 400);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'La función de Conocimientos no está configurada.' }, 503);
  }

  const validationError = validateAction(action, body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerUid = await authorizeWorker(req, body, serviceClient);
  if (!ownerUid) return jsonResponse({ error: 'Conexión del AI Bridge inválida, vencida o desvinculada.' }, 401);

  try {
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
      p_action: ACTIONS[action],
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
});

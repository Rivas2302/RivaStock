export interface WorkerRetrieveRequest {
  job_id: unknown;
  embedding: unknown;
  query: unknown;
  model: unknown;
}

export function validateWorkerRetrieveRequest(body: WorkerRetrieveRequest): string | null {
  if (typeof body.job_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.job_id)) {
    return 'Identificador de tarea inválido.';
  }
  if (!Array.isArray(body.embedding) || body.embedding.length !== 384
    || body.embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return 'Embedding inválido.';
  }
  if (typeof body.query !== 'string' || body.query.length > 8000) return 'Consulta inválida.';
  if (typeof body.model !== 'string' || body.model.length < 1 || body.model.length > 120) {
    return 'Modelo de embeddings inválido.';
  }
  return null;
}

type MemoryWorkerAction =
  | 'worker_memory_retrieve'
  | 'worker_memory_similar'
  | 'worker_memory_apply'
  | 'worker_memory_metric'
  | 'worker_memory_finish'
  | 'worker_memory_chat_summary'
  | 'worker_memory_pending_embeddings'
  | 'worker_memory_store_embeddings'
  | 'worker_memory_touch_similar';

type MemoryWorkerPayload = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateMemoryWorkerAction(action: MemoryWorkerAction, body: MemoryWorkerPayload): string | null {
  switch (action) {
    case 'worker_memory_retrieve':
      return isUuid(body.job_id) && isEmbedding(body.embedding) && isModel(body.model)
        && typeof body.query === 'string' && body.query.length <= 8000
        ? null : 'Solicitud de recuperación de memoria inválida.';
    case 'worker_memory_similar':
      return isUuid(body.job_id) && isEmbedding(body.embedding) ? null : 'Solicitud de similitud de memoria inválida.';
    case 'worker_memory_apply':
      if (!isUuid(body.job_id) || !isModel(body.embedding_model)
        || !Array.isArray(body.operations) || body.operations.length > 5) return 'Operaciones de memoria inválidas.';
      for (const operation of body.operations) {
        if (!isRecord(operation) || (operation.op !== 'add' && operation.op !== 'update' && operation.op !== 'archive')) {
          return 'Operación de memoria inválida.';
        }
        if (operation.op === 'archive') {
          if (!isUuid(operation.id)) return 'Identificador de recuerdo inválido.';
        } else if ((operation.op === 'update' && !isUuid(operation.id))
          || (operation.kind !== 'fact' && operation.kind !== 'preference' && operation.kind !== 'summary')
          || typeof operation.content !== 'string' || operation.content.length < 1
          || operation.content.length > (operation.kind === 'summary' ? 800 : 500)
          || !isEmbedding(operation.embedding)) {
          return 'Recuerdo o embedding inválido.';
        }
      }
      return null;
    case 'worker_memory_metric':
      return isUuid(body.job_id)
        && ['executed', 'skipped_prefilter', 'skipped_deduplication'].includes(String(body.metric))
        && (body.provider === undefined || body.provider === 'local' || body.provider === 'codex')
        ? null : 'Métrica de memoria inválida.';
    case 'worker_memory_finish':
    case 'worker_memory_chat_summary':
      return isUuid(body.job_id) ? null : 'Identificador de tarea inválido.';
    case 'worker_memory_pending_embeddings':
      return null;
    case 'worker_memory_store_embeddings':
      if (!isModel(body.model) || !Array.isArray(body.embeddings)
        || body.embeddings.length < 1 || body.embeddings.length > 16) return 'Lote de embeddings inválido.';
      return body.embeddings.every((item) => isRecord(item) && isUuid(item.id) && isEmbedding(item.embedding))
        ? null : 'Embedding pendiente inválido.';
    case 'worker_memory_touch_similar':
      return isUuid(body.job_id) && Array.isArray(body.ids) && body.ids.length <= 8
        && body.ids.every((id) => isUuid(id)) ? null : 'Recuerdos similares inválidos.';
  }
}

export function memoryWorkerPayload(action: Exclude<MemoryWorkerAction, 'worker_memory_touch_similar'>,
  body: MemoryWorkerPayload): MemoryWorkerPayload {
  switch (action) {
    case 'worker_memory_retrieve': return { embedding: body.embedding, query: body.query };
    case 'worker_memory_similar': return { embedding: body.embedding };
    case 'worker_memory_apply': return { embedding_model: body.embedding_model, operations: body.operations };
    case 'worker_memory_metric': return { metric: body.metric, provider: body.provider };
    case 'worker_memory_finish':
    case 'worker_memory_chat_summary':
    case 'worker_memory_pending_embeddings': return {};
    case 'worker_memory_store_embeddings': return { embeddings: body.embeddings, model: body.model };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 384
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isModel(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 120;
}

const REQUEST_TIMEOUT_MS = 60_000;

export type KnowledgeFormat = 'editor' | 'md' | 'txt' | 'pdf' | 'docx' | 'image';

export interface KnowledgeIndexTask {
  kind: 'index';
  job_id: string;
  attempt: number;
  document_id: string;
  title: string;
  description: string;
  format: KnowledgeFormat;
  version_id: string;
  version_number: number;
  mime_type: string | null;
  file_size: number | null;
  has_file: boolean;
  inline_text: string | null;
}

export interface KnowledgeSearchTask {
  kind: 'search';
  request_id: string;
  query: string;
}

export type KnowledgeTask = KnowledgeIndexTask | KnowledgeSearchTask;

export interface KnowledgeFileUrl {
  url: string;
  mime_type: string | null;
  file_size: number | null;
}

export interface KnowledgeOrganizeImage {
  id: string;
  url: string;
  mime_type: string;
}

export interface CentralTransferFile {
  version_id: string;
  relative_path: string;
  sha256: string;
  file_size: number;
  mime_type: string | null;
  url: string;
}

export interface CentralExpectedFile {
  version_id: string;
  relative_path: string;
  sha256: string;
  file_size: number;
  cloud_purged: boolean;
  storage_location: 'cloud' | 'transferring' | 'local' | 'missing';
}

export interface CentralDeletion {
  id: string;
  relative_path: string;
}

export interface CentralLocalFile {
  relative_path: string;
  sha256: string;
  file_size: number;
  mime_type: string | null;
}

export interface CentralOriginalRequest {
  request_id: string;
  version_id: string;
  relative_path: string;
  sha256: string;
  file_size: number;
  mime_type: string;
  original_filename: string;
  cache_path: string;
  upload_url: string;
}

export interface CentralInventoryEntry {
  version_id: string;
  sha256: string | null;
  present: boolean;
}

export interface KnowledgeRetrievedSource {
  label: string;
  document_id: string;
  title: string;
  version_number: number | null;
  section_path: string;
  page_from: number | null;
  page_to: number | null;
  content: string;
  similarity: number | null;
  score: number;
}

export interface KnowledgeChunkInput {
  chunk_index: number;
  content: string;
  section_path: string;
  page_from: number | null;
  page_to: number | null;
  token_estimate: number;
  content_hash: string;
  embedding: number[];
}

export interface KnowledgeStats {
  ms: number;
  pages: number | null;
  chars: number;
  ocr?: boolean;
  ocr_pages?: number;
  ocr_notice?: string;
}

export interface MemoryCandidate {
  id: string;
  kind: 'fact' | 'preference' | 'summary';
  content: string;
  pinned: boolean;
  source_chat_id: string | null;
  source_job_id: string | null;
  similarity: number | null;
  use_count: number;
  created_at: string;
}

export interface MemoryRetrievalResult {
  enabled: boolean;
  memories: MemoryCandidate[];
  user_turn_count: number;
  message_count: number;
  mode: 'auto' | 'confirm' | 'off';
  top_k: number;
  include_summaries: boolean;
}

export interface MemoryChatHistoryEntry {
  title: string;
  last_message_at: string;
  first_questions: string[];
  summary: string | null;
}

export interface IdleMemorySummaryCandidate {
  chat_id: string;
  job_id: string;
  exchanges: Array<{ input: string; output: string }>;
}

export interface SimilarMemoryResult {
  enabled: boolean;
  memories: Array<Pick<MemoryCandidate, 'id' | 'kind' | 'content' | 'source_chat_id' | 'similarity'>>;
  extraction_settings?: {
    provider: 'codex';
    model_id: 'gpt-6-luna' | 'gpt-6.1-sol' | 'gpt-6-astra';
    reasoning_effort: 'low' | 'medium' | 'high' | 'xhigh';
  } | null;
}

export interface PendingMemoryEmbedding {
  id: string;
  kind: 'fact' | 'preference' | 'summary';
  content: string;
}

export class KnowledgeClient {
  constructor(private readonly endpoint: string, private readonly token: string) {}

  async next(workerId: string): Promise<KnowledgeTask | null> {
    const response = await this.post<{ data: KnowledgeTask | null }>('worker_next', { worker_id: workerId });
    return response.data;
  }

  async jobHeartbeat(workerId: string, jobId: string): Promise<void> {
    await this.post('worker_job_heartbeat', { worker_id: workerId, job_id: jobId });
  }

  async fileUrl(workerId: string, jobId: string): Promise<KnowledgeFileUrl> {
    const response = await this.post<KnowledgeFileUrl>('worker_file_url', { worker_id: workerId, job_id: jobId });
    if (typeof response.url !== 'string' || !/^https:\/\//i.test(response.url)) {
      throw new Error('El backend devolvió una URL de archivo inválida.');
    }
    return response;
  }

  async centralNext(workerId: string): Promise<CentralTransferFile[]> {
    const response = await this.post<{ files: unknown }>('worker_central_next', { worker_id: workerId });
    if (!Array.isArray(response.files) || response.files.length > 5) throw new Error('La lista de transferencias de la central es inválida.');
    return response.files.map((value) => {
      if (!isRecord(value) || typeof value.version_id !== 'string' || !UUID_PATTERN.test(value.version_id)
        || typeof value.relative_path !== 'string' || !isCentralPath(value.relative_path)
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)
        || typeof value.file_size !== 'number' || !Number.isSafeInteger(value.file_size) || value.file_size < 1 || value.file_size > 52_428_800
        || (value.mime_type !== null && typeof value.mime_type !== 'string')
        || typeof value.url !== 'string' || !/^https:\/\//i.test(value.url)) {
        throw new Error('Una transferencia de la central tiene datos inválidos.');
      }
      return value as unknown as CentralTransferFile;
    });
  }

  async centralStored(workerId: string, versionId: string, sha256: string): Promise<{ stored: boolean; reason?: string }> {
    const response = await this.post<{ result: unknown }>('worker_central_stored', {
      worker_id: workerId, version_id: versionId, sha256,
    });
    if (!isRecord(response.result) || typeof response.result.stored !== 'boolean') {
      throw new Error('El backend devolvió una confirmación inválida de la central.');
    }
    return response.result as { stored: boolean; reason?: string };
  }

  async centralExpected(workerId: string, offset: number, limit = 1000): Promise<CentralExpectedFile[]> {
    const response = await this.post<{ files: unknown }>('worker_central_inventory_list', {
      worker_id: workerId, offset, limit,
    });
    if (!Array.isArray(response.files) || response.files.length > limit) throw new Error('El inventario esperado de la central es inválido.');
    return response.files.map((value) => {
      if (!isRecord(value) || typeof value.version_id !== 'string' || !UUID_PATTERN.test(value.version_id)
        || typeof value.relative_path !== 'string' || !isCentralPath(value.relative_path)
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)
        || typeof value.file_size !== 'number' || !Number.isSafeInteger(value.file_size) || value.file_size < 0
        || typeof value.cloud_purged !== 'boolean'
        || !['cloud', 'transferring', 'local', 'missing'].includes(String(value.storage_location))) {
        throw new Error('El backend devolvió una entrada de inventario inválida.');
      }
      return value as unknown as CentralExpectedFile;
    });
  }

  async centralInventory(workerId: string, inventory: CentralInventoryEntry[]): Promise<void> {
    await this.post('worker_central_inventory', { worker_id: workerId, inventory });
  }

  async centralPurge(workerId: string): Promise<number> {
    const response = await this.post<{ purged: unknown }>('worker_central_purge', { worker_id: workerId });
    const count = Number(response.purged);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('El backend devolvió un resultado de purga inválido.');
    return count;
  }

  async centralDeletions(workerId: string): Promise<CentralDeletion[]> {
    const response = await this.post<{ items: unknown }>('worker_central_deletions', { worker_id: workerId });
    if (!Array.isArray(response.items) || response.items.length > 100) throw new Error('La lista de borrados de la central es inválida.');
    return response.items.map((value) => {
      if (!isRecord(value) || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)
        || typeof value.relative_path !== 'string' || !isCentralPath(value.relative_path)) {
        throw new Error('Una solicitud de borrado de la central es inválida.');
      }
      return value as unknown as CentralDeletion;
    });
  }

  async centralDeletionsDone(workerId: string, ids: string[]): Promise<void> {
    await this.post('worker_central_deletions_done', { worker_id: workerId, ids });
  }

  async centralStatus(workerId: string, status: {
    store_bytes: number;
    store_free_bytes: number | null;
    mirror_status: 'none' | 'ok' | 'error';
    mirror_last_ok_at: string | null;
    files_total: number;
    files_missing: number;
  }): Promise<void> {
    await this.post('worker_central_status', { worker_id: workerId, ...status });
  }

  async centralLocalFile(workerId: string, versionId: string): Promise<CentralLocalFile | null> {
    const response = await this.post<{ file: unknown }>('worker_central_local_file', {
      worker_id: workerId, version_id: versionId,
    });
    if (response.file === null) return null;
    if (!isRecord(response.file) || typeof response.file.relative_path !== 'string'
      || !isCentralPath(response.file.relative_path) || typeof response.file.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/i.test(response.file.sha256)
      || typeof response.file.file_size !== 'number' || !Number.isSafeInteger(response.file.file_size)
      || (response.file.mime_type !== null && typeof response.file.mime_type !== 'string')) {
      throw new Error('La referencia local de Conocimientos es inválida.');
    }
    return response.file as unknown as CentralLocalFile;
  }

  async centralRequests(workerId: string): Promise<CentralOriginalRequest[]> {
    const response = await this.post<{ requests: unknown }>('worker_central_requests', { worker_id: workerId });
    if (!Array.isArray(response.requests) || response.requests.length > 1) {
      throw new Error('La lista de originales pendientes de la central es inválida.');
    }
    return response.requests.map((value) => {
      if (!isRecord(value) || typeof value.request_id !== 'string' || !UUID_PATTERN.test(value.request_id)
        || typeof value.version_id !== 'string' || !UUID_PATTERN.test(value.version_id)
        || typeof value.relative_path !== 'string' || !isCentralPath(value.relative_path)
        || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)
        || typeof value.file_size !== 'number' || !Number.isSafeInteger(value.file_size)
        || value.file_size < 1 || value.file_size > 52_428_800
        || typeof value.mime_type !== 'string'
        || !['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain', 'text/markdown', 'text/x-markdown', 'image/png', 'image/jpeg', 'image/webp'].includes(value.mime_type)
        || typeof value.original_filename !== 'string' || value.original_filename.length > 255
        || typeof value.cache_path !== 'string' || !isCachePath(value.cache_path, value.relative_path, value.request_id)
        || typeof value.upload_url !== 'string'
        || !isSignedStorageUploadUrl(value.upload_url, this.endpoint, value.cache_path)) {
        throw new Error('Una solicitud de original de la central tiene datos inválidos.');
      }
      return value as unknown as CentralOriginalRequest;
    });
  }

  async centralRequestReady(workerId: string, requestId: string, cachePath: string): Promise<boolean> {
    const response = await this.post<{ ready: unknown }>('worker_central_request_ready', {
      worker_id: workerId, request_id: requestId, cache_path: cachePath,
    });
    if (typeof response.ready !== 'boolean') throw new Error('La confirmación del original es inválida.');
    return response.ready;
  }

  async centralRequestFailed(workerId: string, requestId: string, error: string, cachePath?: string): Promise<void> {
    await this.post('worker_central_request_failed', {
      worker_id: workerId, request_id: requestId, error, ...(cachePath ? { cache_path: cachePath } : {}),
    });
  }

  async centralCacheCleanup(workerId: string): Promise<number> {
    const response = await this.post<{ cleaned: unknown }>('worker_central_cache_cleanup', { worker_id: workerId });
    const count = Number(response.cleaned);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('El resultado de la limpieza de originales es inválido.');
    return count;
  }

  async organizeImages(workerId: string, jobId: string): Promise<KnowledgeOrganizeImage[]> {
    const response = await this.post<{ images: unknown }>('worker_organize_images', {
      worker_id: workerId, job_id: jobId,
    });
    if (!Array.isArray(response.images) || response.images.length > 12) {
      throw new Error('El backend devolvió una lista de capturas inválida.');
    }
    return response.images.map((image) => {
      if (!image || typeof image !== 'object'
        || typeof (image as KnowledgeOrganizeImage).id !== 'string'
        || typeof (image as KnowledgeOrganizeImage).url !== 'string'
        || !/^https:\/\//i.test((image as KnowledgeOrganizeImage).url)
        || typeof (image as KnowledgeOrganizeImage).mime_type !== 'string') {
        throw new Error('El backend devolvió una captura inválida.');
      }
      return image as KnowledgeOrganizeImage;
    });
  }

  async retrieve(
    workerId: string,
    jobId: string,
    embedding: number[],
    query: string,
    model: string,
  ): Promise<KnowledgeRetrievedSource[]> {
    const response = await this.post<{ enabled: unknown; sources: unknown }>('worker_retrieve', {
      worker_id: workerId, job_id: jobId, embedding, query, model,
    });
    if (response.enabled === false) return [];
    if (response.enabled !== true || !Array.isArray(response.sources)) {
      throw new Error('El backend devolvió una respuesta de recuperación inválida.');
    }
    if (response.sources.length > 12) throw new Error('El backend devolvió demasiadas fuentes de Conocimientos.');
    return response.sources.map((source) => {
      if (!source || typeof source !== 'object') throw new Error('El backend devolvió una fuente inválida.');
      const item = source as Partial<KnowledgeRetrievedSource>;
      if (typeof item.label !== 'string' || !/^K[0-9]{1,2}$/.test(item.label)
        || typeof item.document_id !== 'string' || typeof item.title !== 'string'
        || typeof item.section_path !== 'string' || typeof item.content !== 'string'
        || item.title.length > 160 || item.section_path.length > 300 || item.content.length > 4000
        || typeof item.score !== 'number' || !Number.isFinite(item.score)
        || (item.version_number !== null && (typeof item.version_number !== 'number'
          || !Number.isSafeInteger(item.version_number) || item.version_number < 1))
        || (item.page_from !== null && (typeof item.page_from !== 'number'
          || !Number.isSafeInteger(item.page_from) || item.page_from < 1))
        || (item.page_to !== null && (typeof item.page_to !== 'number'
          || !Number.isSafeInteger(item.page_to) || item.page_to < 1))
        || (item.similarity !== null && (typeof item.similarity !== 'number' || !Number.isFinite(item.similarity)))) {
        throw new Error('El backend devolvió una fuente inválida.');
      }
      return item as KnowledgeRetrievedSource;
    });
  }

  async memoryRetrieve(
    workerId: string,
    jobId: string,
    embedding: number[],
    query: string,
    model: string,
  ): Promise<MemoryRetrievalResult> {
    const response = await this.post<MemoryRetrievalResult>('worker_memory_retrieve', {
      worker_id: workerId, job_id: jobId, embedding, query, model,
    });
    if (typeof response.enabled !== 'boolean' || !Array.isArray(response.memories)
      || !Number.isSafeInteger(response.user_turn_count) || !Number.isSafeInteger(response.message_count)
      || !['auto', 'confirm', 'off'].includes(response.mode) || !Number.isSafeInteger(response.top_k)
      || typeof response.include_summaries !== 'boolean' || response.memories.length > 1000) {
      throw new Error('El backend devolvió una respuesta de memoria inválida.');
    }
    return { ...response, memories: response.memories.map(validateMemoryCandidate) };
  }

  async memorySimilar(workerId: string, jobId: string, embedding: number[], signal?: AbortSignal): Promise<SimilarMemoryResult> {
    const response = await this.post<SimilarMemoryResult>('worker_memory_similar', {
      worker_id: workerId, job_id: jobId, embedding,
    }, signal);
    if (typeof response.enabled !== 'boolean' || !Array.isArray(response.memories) || response.memories.length > 8) {
      throw new Error('El backend devolvió recuerdos similares inválidos.');
    }
    const extractionSettings = response.extraction_settings ?? null;
    if (extractionSettings !== null && (extractionSettings.provider !== 'codex'
      || !['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].includes(extractionSettings.model_id)
      || !['low', 'medium', 'high', 'xhigh'].includes(extractionSettings.reasoning_effort))) {
      throw new Error('La configuración de extracción de memoria es inválida.');
    }
    return {
      ...response,
      extraction_settings: extractionSettings,
      memories: response.memories.map((memory) => {
        const candidate = validateMemoryCandidate({
          ...memory, pinned: false, source_job_id: null, use_count: 0, created_at: '',
        });
        return { id: candidate.id, kind: candidate.kind, content: candidate.content,
          source_chat_id: candidate.source_chat_id, similarity: candidate.similarity };
      }),
    };
  }

  async memoryApply(workerId: string, jobId: string, payload: {
    embedding_model: string;
    operations: Array<Record<string, unknown>>;
  }, signal?: AbortSignal): Promise<void> {
    await this.post('worker_memory_apply', { worker_id: workerId, job_id: jobId, ...payload }, signal);
  }

  async memoryMetric(workerId: string, jobId: string, metric: 'executed' | 'skipped_prefilter' | 'skipped_deduplication', provider?: 'local' | 'codex', signal?: AbortSignal): Promise<void> {
    await this.post('worker_memory_metric', { worker_id: workerId, job_id: jobId, metric, ...(provider ? { provider } : {}) }, signal);
  }

  async memoryFinish(workerId: string, jobId: string): Promise<void> {
    await this.post('worker_memory_finish', { worker_id: workerId, job_id: jobId });
  }

  async memoryChatSummary(workerId: string, jobId: string, signal?: AbortSignal): Promise<MemoryCandidate | null> {
    const response = await this.post<{ summary: unknown }>('worker_memory_chat_summary', {
      worker_id: workerId, job_id: jobId,
    }, signal);
    return response.summary === null ? null : validateMemoryCandidate(response.summary);
  }

  async memoryChatIndex(workerId: string, jobId: string): Promise<MemoryChatHistoryEntry[]> {
    const response = await this.post<{ chats: unknown }>('worker_memory_chat_index', {
      worker_id: workerId, job_id: jobId,
    });
    if (!Array.isArray(response.chats) || response.chats.length > 8) {
      throw new Error('El índice de conversaciones anteriores es inválido.');
    }
    return response.chats.map((value) => {
      if (!isRecord(value) || typeof value.title !== 'string' || value.title.length > 80
        || typeof value.last_message_at !== 'string' || Number.isNaN(Date.parse(value.last_message_at))
        || !Array.isArray(value.first_questions) || value.first_questions.length > 3
        || !value.first_questions.every((question) => typeof question === 'string' && question.length <= 400)
        || (value.summary !== null && (typeof value.summary !== 'string' || value.summary.length > 2000))) {
        throw new Error('Una conversación del índice tiene datos inválidos.');
      }
      return {
        title: value.title,
        last_message_at: value.last_message_at,
        first_questions: value.first_questions as string[],
        summary: value.summary as string | null,
      };
    });
  }

  async idleMemorySummaryCandidates(workerId: string, signal?: AbortSignal): Promise<IdleMemorySummaryCandidate[]> {
    const response = await this.post<{ candidates: unknown }>('worker_memory_idle_summary_candidates', {
      worker_id: workerId, limit: 1,
    }, signal);
    if (!Array.isArray(response.candidates) || response.candidates.length > 1) {
      throw new Error('La lista de resúmenes pendientes es inválida.');
    }
    return response.candidates.map((value) => {
      if (!isRecord(value) || typeof value.chat_id !== 'string' || !UUID_PATTERN.test(value.chat_id)
        || typeof value.job_id !== 'string' || !UUID_PATTERN.test(value.job_id)
        || !Array.isArray(value.exchanges) || value.exchanges.length < 1 || value.exchanges.length > 6
        || !value.exchanges.every((exchange) => isRecord(exchange)
          && typeof exchange.input === 'string' && exchange.input.length <= 8000
          && typeof exchange.output === 'string' && exchange.output.length <= 20000)) {
        throw new Error('Un resumen pendiente de conversación es inválido.');
      }
      return {
        chat_id: value.chat_id,
        job_id: value.job_id,
        exchanges: value.exchanges as Array<{ input: string; output: string }>,
      };
    });
  }

  async pendingMemoryEmbeddings(workerId: string, signal?: AbortSignal): Promise<PendingMemoryEmbedding[]> {
    const response = await this.post<{ memories: unknown }>('worker_memory_pending_embeddings', { worker_id: workerId }, signal);
    if (!Array.isArray(response.memories) || response.memories.length > 16) throw new Error('La lista de embeddings pendientes es inválida.');
    return response.memories.map((memory) => {
      if (!memory || typeof memory !== 'object') throw new Error('Un embedding pendiente es inválido.');
      const item = memory as Partial<PendingMemoryEmbedding>;
      if (typeof item.id !== 'string' || !UUID_PATTERN.test(item.id)
        || (item.kind !== 'fact' && item.kind !== 'preference' && item.kind !== 'summary')
        || typeof item.content !== 'string' || item.content.length > (item.kind === 'summary' ? 2000 : 500)) {
        throw new Error('Un embedding pendiente es inválido.');
      }
      return item as PendingMemoryEmbedding;
    });
  }

  async storeMemoryEmbeddings(workerId: string, embeddings: Array<{ id: string; embedding: number[] }>, model: string, signal?: AbortSignal): Promise<void> {
    await this.post('worker_memory_store_embeddings', { worker_id: workerId, embeddings, model }, signal);
  }

  async touchSimilarMemory(workerId: string, jobId: string, ids: string[], signal?: AbortSignal): Promise<void> {
    await this.post('worker_memory_touch_similar', { worker_id: workerId, job_id: jobId, ids }, signal);
  }

  async extractedText(workerId: string, jobId: string, text: string, pageCount: number | null): Promise<void> {
    await this.post('worker_extracted_text', {
      worker_id: workerId, job_id: jobId, text, page_count: pageCount,
    });
  }

  async submitChunks(
    workerId: string,
    jobId: string,
    embeddingModel: string,
    chunks: KnowledgeChunkInput[],
  ): Promise<void> {
    await this.post('worker_submit_chunks', {
      worker_id: workerId, job_id: jobId, embedding_model: embeddingModel, chunks,
    });
  }

  async complete(
    workerId: string,
    jobId: string,
    chunkCount: number,
    embeddingModel: string,
    stats: KnowledgeStats,
  ): Promise<void> {
    await this.post('worker_complete', {
      worker_id: workerId, job_id: jobId, chunk_count: chunkCount, embedding_model: embeddingModel, stats,
    });
  }

  async fail(workerId: string, jobId: string, error: string, retryable: boolean): Promise<void> {
    await this.post('worker_fail', { worker_id: workerId, job_id: jobId, error, retryable });
  }

  async searchResult(workerId: string, requestId: string, embedding: number[], model: string): Promise<void> {
    await this.post('worker_search_result', {
      worker_id: workerId, request_id: requestId, embedding, model,
    });
  }

  async searchFail(workerId: string, requestId: string, error: string): Promise<void> {
    await this.post('worker_search_fail', { worker_id: workerId, request_id: requestId, error });
  }

  private async post<T = unknown>(action: string, fields: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof payload?.error === 'string' ? payload.error : `El backend respondió ${response.status}.`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== 'object') throw new Error('El backend devolvió una respuesta inválida.');
    return payload as T;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCentralPath(path: string): boolean {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[0-9]{1,5}\/[A-Za-z0-9._-]{1,120}$/i.test(path)
    && !path.split('/').some((part) => part === '.' || part === '..');
}

function isCachePath(path: string, relativePath: string, requestId: string): boolean {
  const ownerId = relativePath.split('/')[0];
  return path.startsWith(ownerId + '/' + requestId + '/')
    && new RegExp('^' + ownerId + '/' + requestId + '/[A-Za-z0-9._-]{1,120}$', 'i').test(path);
}

function isSignedStorageUploadUrl(value: string, endpoint: string, cachePath: string): boolean {
  try {
    const uploadUrl = new URL(value);
    const functionUrl = new URL(endpoint);
    const projectRef = functionUrl.hostname.split('.')[0];
    return functionUrl.protocol === 'https:'
      && uploadUrl.protocol === 'https:'
      && uploadUrl.hostname === `${projectRef}.storage.supabase.co`
      && uploadUrl.pathname === `/storage/v1/s3/knowledge-cache/${cachePath}`
      && uploadUrl.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256'
      && Boolean(uploadUrl.searchParams.get('X-Amz-Credential'))
      && Boolean(uploadUrl.searchParams.get('X-Amz-Signature'));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateMemoryCandidate(value: unknown): MemoryCandidate {
  if (!value || typeof value !== 'object') throw new Error('El backend devolvió un recuerdo inválido.');
  const item = value as Partial<MemoryCandidate>;
  if (typeof item.id !== 'string' || !UUID_PATTERN.test(item.id)
    || (item.kind !== 'fact' && item.kind !== 'preference' && item.kind !== 'summary')
    || typeof item.content !== 'string' || item.content.length > 2000
    || typeof item.pinned !== 'boolean'
    || (item.source_chat_id !== null && typeof item.source_chat_id !== 'string')
    || (item.source_job_id !== null && typeof item.source_job_id !== 'string')
    || (item.similarity !== null && (typeof item.similarity !== 'number' || !Number.isFinite(item.similarity)))
    || typeof item.use_count !== 'number' || !Number.isSafeInteger(item.use_count)
    || typeof item.created_at !== 'string') {
    throw new Error('El backend devolvió un recuerdo inválido.');
  }
  return item as MemoryCandidate;
}

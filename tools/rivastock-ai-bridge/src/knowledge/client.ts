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

export interface SimilarMemoryResult {
  enabled: boolean;
  memories: Array<Pick<MemoryCandidate, 'id' | 'kind' | 'content' | 'source_chat_id' | 'similarity'>>;
}

export interface PendingMemoryEmbedding {
  id: string;
  kind: 'fact' | 'preference';
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

  async memorySimilar(workerId: string, jobId: string, embedding: number[]): Promise<SimilarMemoryResult> {
    const response = await this.post<SimilarMemoryResult>('worker_memory_similar', {
      worker_id: workerId, job_id: jobId, embedding,
    });
    if (typeof response.enabled !== 'boolean' || !Array.isArray(response.memories) || response.memories.length > 8) {
      throw new Error('El backend devolvió recuerdos similares inválidos.');
    }
    return {
      ...response,
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
  }): Promise<void> {
    await this.post('worker_memory_apply', { worker_id: workerId, job_id: jobId, ...payload });
  }

  async memoryMetric(workerId: string, jobId: string, metric: 'executed' | 'skipped_prefilter' | 'skipped_deduplication', provider?: 'local' | 'codex'): Promise<void> {
    await this.post('worker_memory_metric', { worker_id: workerId, job_id: jobId, metric, ...(provider ? { provider } : {}) });
  }

  async memoryFinish(workerId: string, jobId: string): Promise<void> {
    await this.post('worker_memory_finish', { worker_id: workerId, job_id: jobId });
  }

  async memoryChatSummary(workerId: string, jobId: string): Promise<MemoryCandidate | null> {
    const response = await this.post<{ summary: unknown }>('worker_memory_chat_summary', {
      worker_id: workerId, job_id: jobId,
    });
    return response.summary === null ? null : validateMemoryCandidate(response.summary);
  }

  async pendingMemoryEmbeddings(workerId: string): Promise<PendingMemoryEmbedding[]> {
    const response = await this.post<{ memories: unknown }>('worker_memory_pending_embeddings', { worker_id: workerId });
    if (!Array.isArray(response.memories) || response.memories.length > 16) throw new Error('La lista de embeddings pendientes es inválida.');
    return response.memories.map((memory) => {
      if (!memory || typeof memory !== 'object') throw new Error('Un embedding pendiente es inválido.');
      const item = memory as Partial<PendingMemoryEmbedding>;
      if (typeof item.id !== 'string' || !UUID_PATTERN.test(item.id)
        || (item.kind !== 'fact' && item.kind !== 'preference') || typeof item.content !== 'string' || item.content.length > 500) {
        throw new Error('Un embedding pendiente es inválido.');
      }
      return item as PendingMemoryEmbedding;
    });
  }

  async storeMemoryEmbeddings(workerId: string, embeddings: Array<{ id: string; embedding: number[] }>, model: string): Promise<void> {
    await this.post('worker_memory_store_embeddings', { worker_id: workerId, embeddings, model });
  }

  async touchSimilarMemory(workerId: string, jobId: string, ids: string[]): Promise<void> {
    await this.post('worker_memory_touch_similar', { worker_id: workerId, job_id: jobId, ids });
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

  private async post<T = unknown>(action: string, fields: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

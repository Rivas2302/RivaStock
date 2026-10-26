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

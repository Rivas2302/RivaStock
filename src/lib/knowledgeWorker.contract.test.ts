import { describe, expect, it } from 'vitest';
import {
  memoryWorkerPayload,
  validateCentralWorkerAction,
  validateMemoryWorkerAction,
  validateWorkerRetrieveRequest,
} from '../../supabase/functions/knowledge/contract';

const validRequest = {
  job_id: '30000000-0000-4000-8000-000000000001',
  embedding: Array.from({ length: 384 }, (_, index) => index / 384),
  query: 'consulta',
  model: 'Xenova/multilingual-e5-small',
};

describe('knowledge worker retrieve request contract', () => {
  it('accepts a complete bounded retrieval request', () => {
    expect(validateWorkerRetrieveRequest(validRequest)).toBeNull();
  });

  it('rejects malformed job ids, wrong embedding dimensions, non-finite values, oversized queries, and invalid models', () => {
    expect(validateWorkerRetrieveRequest({ ...validRequest, job_id: 'bad' })).toBe('Identificador de tarea inválido.');
    expect(validateWorkerRetrieveRequest({ ...validRequest, embedding: validRequest.embedding.slice(1) })).toBe('Embedding inválido.');
    expect(validateWorkerRetrieveRequest({ ...validRequest, embedding: [Number.NaN, ...validRequest.embedding.slice(1)] })).toBe('Embedding inválido.');
    expect(validateWorkerRetrieveRequest({ ...validRequest, query: 'x'.repeat(8001) })).toBe('Consulta inválida.');
    expect(validateWorkerRetrieveRequest({ ...validRequest, model: '' })).toBe('Modelo de embeddings inválido.');
  });
});

describe('knowledge memory worker contract', () => {
  it('validates retrieval, bounded apply operations, and touch IDs', () => {
    const jobId = validRequest.job_id;
    const embedding = validRequest.embedding;
    expect(validateMemoryWorkerAction('worker_memory_retrieve', {
      job_id: jobId, embedding, query: 'query', model: validRequest.model,
    })).toBeNull();
    expect(validateMemoryWorkerAction('worker_memory_retrieve', {
      job_id: jobId, embedding, query: 'query', model: validRequest.model, include_summaries: true,
    })).toBeNull();
    expect(validateMemoryWorkerAction('worker_memory_retrieve', {
      job_id: jobId, embedding, query: 'query', model: validRequest.model, include_summaries: 'true',
    })).not.toBeNull();
    expect(validateMemoryWorkerAction('worker_memory_retrieve', {
      job_id: jobId, embedding: embedding.slice(1), query: 'query', model: validRequest.model,
    })).toMatch(/inválida/);
    expect(validateMemoryWorkerAction('worker_memory_apply', {
      job_id: jobId, embedding_model: validRequest.model,
      operations: [{ op: 'update', id: '00000000-0000-4000-8000-000000000001',
        kind: 'fact', content: 'Actualizado', embedding }],
    })).toBeNull();
    expect(validateMemoryWorkerAction('worker_memory_apply', {
      job_id: jobId, embedding_model: validRequest.model,
      operations: [{ op: 'update', id: 'not-a-uuid', kind: 'fact', content: 'Actualizado', embedding }],
    })).toMatch(/inválido/);
    expect(validateMemoryWorkerAction('worker_memory_touch_similar', {
      job_id: jobId, ids: ['00000000-0000-4000-8000-000000000001'],
    })).toBeNull();
  });

  it('maps memory actions to narrowly scoped SQL payloads', () => {
    expect(memoryWorkerPayload('worker_memory_retrieve', {
      job_id: validRequest.job_id, embedding: validRequest.embedding, query: 'query', model: validRequest.model,
      worker_id: 'worker',
    })).toEqual({ embedding: validRequest.embedding, query: 'query' });
    expect(memoryWorkerPayload('worker_memory_finish', { job_id: validRequest.job_id, worker_id: 'worker' })).toEqual({});
  });
});

describe('knowledge central worker contract', () => {
  const versionId = '30000000-0000-4000-8000-000000000001';
  const sha256 = 'a'.repeat(64);

  it('bounds and validates transfer, inventory, status, and deletion payloads', () => {
    expect(validateCentralWorkerAction('worker_central_next', {})).toBeNull();
    expect(validateCentralWorkerAction('worker_central_stored', { version_id: versionId, sha256 })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_stored', { version_id: versionId, sha256: 'bad' })).toMatch(/inválida/);
    expect(validateCentralWorkerAction('worker_central_inventory', {
      inventory: [{ version_id: versionId, sha256: null, present: true }],
    })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_inventory', {
      inventory: [{ version_id: versionId, sha256, present: 'true' }],
    })).toMatch(/inválido/);
    expect(validateCentralWorkerAction('worker_central_inventory_list', { offset: 0, limit: 1000 })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_inventory_list', { offset: -1, limit: 1001 })).toMatch(/inválida/);
    expect(validateCentralWorkerAction('worker_central_deletions_done', { ids: [versionId] })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_requests', {})).toBeNull();
    expect(validateCentralWorkerAction('worker_central_request_ready', {
      request_id: versionId, cache_path: '10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/manual.pdf',
    })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_request_ready', {
      request_id: 'bad', cache_path: 'bad',
    })).toMatch(/inválida/);
    expect(validateCentralWorkerAction('worker_central_request_failed', {
      request_id: versionId, error: 'No se pudo preparar el original.',
    })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_status', {
      store_bytes: 100, store_free_bytes: 500, mirror_status: 'ok', mirror_last_ok_at: null,
      files_total: 1, files_missing: 0,
    })).toBeNull();
    expect(validateCentralWorkerAction('worker_central_status', {
      store_bytes: -1, store_free_bytes: 500, mirror_status: 'ok', mirror_last_ok_at: null,
      files_total: 1, files_missing: 0,
    })).toMatch(/inválido/);
  });
});

import { describe, expect, it } from 'vitest';
import { validateWorkerRetrieveRequest } from '../../supabase/functions/knowledge/contract';

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

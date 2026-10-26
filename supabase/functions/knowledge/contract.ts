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

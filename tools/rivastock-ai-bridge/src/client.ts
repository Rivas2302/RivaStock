import type { AIJob, AIProviderId } from './types.ts';

const REQUEST_TIMEOUT_MS = 15_000;

export class BridgeClient {
  constructor(private readonly endpoint: string, private readonly token: string) {}

  async heartbeat(workerId: string, state: 'idle' | 'busy', jobId: string | null = null): Promise<void> {
    await this.post('worker_heartbeat', { worker_id: workerId, state, job_id: jobId });
  }

  async claim(workerId: string): Promise<AIJob | null> {
    const response = await this.post<{ data: AIJob | null }>('worker_claim', { worker_id: workerId });
    return response.data;
  }

  async complete(workerId: string, jobId: string, output: string): Promise<void> {
    await this.post('worker_complete', { worker_id: workerId, job_id: jobId, output });
  }

  async fail(workerId: string, jobId: string, error: string): Promise<void> {
    await this.post('worker_fail', { worker_id: workerId, job_id: jobId, error });
  }

  private async post<T = unknown>(action: string, fields: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? `El backend respondió ${response.status}.`);
    if (!payload || typeof payload !== 'object') throw new Error('El backend devolvió una respuesta inválida.');
    return payload as T;
  }
}

export function isAIProviderId(value: string): value is AIProviderId {
  return value === 'mock' || value === 'codex' || value === 'claude';
}

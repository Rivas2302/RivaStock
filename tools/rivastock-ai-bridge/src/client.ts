import type { AIJob, AIJobContext, AIProviderId, AIWorkspaceFile } from './types.ts';

const REQUEST_TIMEOUT_MS = 15_000;

export class BridgeClient {
  constructor(private readonly endpoint: string, private readonly token: string) {}

  async heartbeat(workerId: string, state: 'idle' | 'busy', jobId: string | null = null): Promise<void> {
    await this.post('worker_heartbeat', { worker_id: workerId, state, job_id: jobId });
  }

  async claim(workerId: string): Promise<{ job: AIJob | null; shouldStop: boolean }> {
    const response = await this.post<{ data: AIJob | null; should_stop?: boolean }>('worker_claim', {
      worker_id: workerId,
      supports_update_signal: true,
    });
    return { job: response.data, shouldStop: response.should_stop === true };
  }

  async start(workerId: string): Promise<void> {
    await this.post('worker_start', { worker_id: workerId });
  }

  async complete(workerId: string, jobId: string, output: string, sessionId?: string): Promise<void> {
    await this.post('worker_complete', {
      worker_id: workerId,
      job_id: jobId,
      output,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  }

  async fail(workerId: string, jobId: string, error: string): Promise<void> {
    await this.post('worker_fail', { worker_id: workerId, job_id: jobId, error });
  }

  async workspaceFiles(workerId: string): Promise<AIWorkspaceFile[]> {
    const response = await this.post<{ files: AIWorkspaceFile[] }>('worker_workspace', { worker_id: workerId });
    if (!Array.isArray(response.files)) throw new Error('El backend devolvió una biblioteca inválida.');
    return response.files;
  }

  async jobContext(workerId: string, jobId: string): Promise<AIJobContext> {
    return this.post('worker_context', { worker_id: workerId, job_id: jobId });
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

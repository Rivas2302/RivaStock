import type { AIJob, AIJobContext, AIProviderId, AIWorkspaceFile } from './types.ts';

const REQUEST_TIMEOUT_MS = 15_000;
const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AIChatTombstone {
  chat_id: string;
  provider: AIProviderId;
  deleted_at: string;
}

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

  async chatTombstones(workerId: string): Promise<AIChatTombstone[]> {
    const response = await this.post<{ tombstones: unknown }>('worker_chat_tombstones', { worker_id: workerId });
    if (!Array.isArray(response.tombstones) || response.tombstones.length > 50) {
      throw new Error('El backend devolvió lápidas de chat inválidas.');
    }
    return response.tombstones.map((item) => {
      if (typeof item !== 'object' || item === null || !('chat_id' in item)
        || typeof item.chat_id !== 'string' || !CHAT_ID_PATTERN.test(item.chat_id)
        || !('provider' in item) || typeof item.provider !== 'string' || !isAIProviderId(item.provider)
        || !('deleted_at' in item) || typeof item.deleted_at !== 'string') {
        throw new Error('El backend devolvió una lápida de chat inválida.');
      }
      return { chat_id: item.chat_id, provider: item.provider, deleted_at: item.deleted_at };
    });
  }

  async acknowledgeChatTombstones(workerId: string, chatIds: string[]): Promise<void> {
    if (!chatIds.length || chatIds.length > 50 || !chatIds.every((id) => CHAT_ID_PATTERN.test(id))) {
      throw new Error('Lista de lápidas inválida.');
    }
    await this.post('worker_chat_tombstones_ack', { worker_id: workerId, chat_ids: chatIds });
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

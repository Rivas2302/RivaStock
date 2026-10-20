import { supabase } from './supabase';

export type AIProviderId = 'mock' | 'codex' | 'claude';
export type CodexModelId = 'gpt-6-luna' | 'gpt-6.1-sol' | 'gpt-6-astra';
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type AIJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AIBridgeState = 'offline' | 'idle' | 'busy';

export interface AIBridgeStatus {
  state: AIBridgeState;
  last_seen_at: string | null;
  paired: boolean;
  legacy: boolean;
  device: { id: string; name: string } | null;
}

export interface AIBridgePairing {
  endpoint: string;
  pairing: {
    device_id: string;
    name: string;
    pairing_code: string;
    pairing_expires_at: string;
  };
}

export interface AIJob {
  id: string;
  provider: AIProviderId;
  task_type: 'text_generation';
  input: string;
  output: string | null;
  status: AIJobStatus;
  error: string | null;
  include_business_context: boolean;
  include_project_context: boolean;
  model_id?: CodexModelId | null;
  reasoning_effort?: CodexReasoningEffort | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  attempt_count: number;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-bridge', { body });
  if (error) {
    let message = error.message || 'No se pudo conectar con el servicio de IA.';
    if (error.context instanceof Response) {
      try {
        const payload = await error.context.json() as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // Keep the SDK's useful fallback message for non-JSON responses.
      }
    }
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') throw new Error('El servicio de IA devolvió una respuesta inválida.');
  const payload = data as { error?: string };
  if (payload.error) throw new Error(payload.error);
  return data as T;
}

export async function createAIJob(
  input: string,
  provider: AIProviderId,
  idempotencyKey: string,
  context: {
    includeBusinessContext: boolean;
    includeProjectContext: boolean;
    modelId: CodexModelId;
    reasoningEffort: CodexReasoningEffort;
  },
): Promise<AIJob> {
  const result = await invoke<{ job: AIJob }>({
    action: 'create',
    idempotency_key: idempotencyKey,
    provider,
    input,
    include_business_context: context.includeBusinessContext,
    include_project_context: context.includeProjectContext,
    model_id: provider === 'codex' ? context.modelId : null,
    reasoning_effort: provider === 'codex' ? context.reasoningEffort : null,
  });
  return result.job;
}

export async function getAIJob(jobId: string): Promise<AIJob> {
  const result = await invoke<{ job: AIJob }>({ action: 'get', job_id: jobId });
  return result.job;
}

export async function getRecentAIJobs(): Promise<AIJob[]> {
  const result = await invoke<{ jobs: AIJob[] }>({ action: 'recent' });
  return result.jobs;
}

export async function getAIBridgeState(): Promise<AIBridgeStatus> {
  return invoke({ action: 'status' });
}

export async function pairAIBridgeDevice(name = 'Mi PC'): Promise<AIBridgePairing> {
  return invoke({ action: 'pair_device', name });
}

export async function revokeAIBridgeDevice(deviceId: string): Promise<void> {
  await invoke({ action: 'revoke_device', device_id: deviceId });
}

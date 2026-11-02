import type { SupervisorDecision, SupervisedResultAssessment, SupervisorDomSummary, SupervisorIntent } from './validate.ts';
import type { CodexModelId, CodexReasoningEffort } from '../types.ts';

const REQUEST_TIMEOUT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODEX_MODELS = new Set<CodexModelId>(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']);
const REASONING_EFFORTS = new Set<CodexReasoningEffort>(['low', 'medium', 'high', 'xhigh']);

export interface SupervisorSettings {
  provider: 'codex' | 'claude' | 'local';
  model_id: string;
  reasoning_effort: CodexReasoningEffort;
}

export interface SupervisorTask {
  id: string;
  trace_id: string;
  step_seq: number;
  kind: 'recover_step' | 'verify_result' | 'review_content' | 'review_photos';
  intent: SupervisorIntent;
  dom_summary: SupervisorDomSummary;
  screenshot_url: string | null;
  settings: SupervisorSettings;
  lease_expires_at: string;
}

export interface SupervisorDecisionRecord {
  decision: SupervisorDecision | SupervisedResultAssessment;
  provider: 'codex' | 'claude';
  model_id: string;
  reasoning_effort: CodexReasoningEffort;
}

export class SupervisorClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async next(workerId: string): Promise<SupervisorTask | null> {
    const response = await this.post<{ task: unknown }>({ action: 'supervisor_worker', operation: 'next', worker_id: workerId });
    if (response.task === null) return null;
    return validateTask(response.task);
  }

  async answer(workerId: string, taskId: string, data: SupervisorDecisionRecord): Promise<void> {
    await this.post({ action: 'supervisor_worker', operation: 'answer', worker_id: workerId, id: taskId, data });
  }

  async fail(workerId: string, taskId: string, error: string): Promise<void> {
    await this.post({ action: 'supervisor_worker', operation: 'fail', worker_id: workerId, id: taskId, data: { error: error.slice(0, 500) } });
  }

  private async post<T = unknown>(body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `El backend respondió ${response.status}.`);
    if (!payload || typeof payload !== 'object') throw new Error('El backend devolvió una respuesta inválida.');
    return payload as T;
  }
}

function validateTask(value: unknown): SupervisorTask {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.trace_id)
    || !Number.isSafeInteger(value.step_seq) || (value.step_seq as number) < 1 || (value.step_seq as number) > 10000
    || !['recover_step', 'verify_result', 'review_content', 'review_photos'].includes(String(value.kind))
    || !isRecord(value.intent) || byteLength(value.intent) > 8000
    || !isDomSummary(value.dom_summary) || byteLength(value.dom_summary) > 20480
    || (value.screenshot_url !== null && (typeof value.screenshot_url !== 'string' || !/^https:\/\//i.test(value.screenshot_url)))
    || typeof value.lease_expires_at !== 'string' || !Number.isFinite(Date.parse(value.lease_expires_at))
    || !isSettings(value.settings)) {
    throw new Error('El backend devolvió una solicitud de supervisión inválida.');
  }
  return value as unknown as SupervisorTask;
}

function isSettings(value: unknown): value is SupervisorSettings {
  if (!isRecord(value) || !['codex', 'claude', 'local'].includes(String(value.provider))
    || typeof value.model_id !== 'string' || value.model_id.length < 1 || value.model_id.length > 120
    || !REASONING_EFFORTS.has(value.reasoning_effort as CodexReasoningEffort)) return false;
  return value.provider !== 'codex' || CODEX_MODELS.has(value.model_id as CodexModelId);
}

function isDomSummary(value: unknown): value is SupervisorDomSummary {
  if (!isRecord(value) || !['dialog', 'form', 'page'].includes(String(value.scope))
    || !Array.isArray(value.controls) || value.controls.length > 80) return false;
  return value.controls.every((control) => isRecord(control)
    && Number.isSafeInteger(control.index) && (control.index as number) >= 0 && (control.index as number) <= 79
    && typeof control.role === 'string' && control.role.length <= 40
    && typeof control.name === 'string' && control.name.length <= 120
    && (control.text === undefined || (typeof control.text === 'string' && control.text.length <= 500))
    && (control.links === undefined || (Array.isArray(control.links) && control.links.length <= 5
      && control.links.every(link => typeof link === 'string' && link.length <= 300 && /^https:\/\/www\.facebook\.com\//i.test(link))))
    && (control.type === undefined || (typeof control.type === 'string' && control.type.length <= 40))
    && (control.placeholder === undefined || (typeof control.placeholder === 'string' && control.placeholder.length <= 120))
    && (control.state === undefined || (isRecord(control.state)
      && (control.state.disabled === undefined || typeof control.state.disabled === 'boolean'))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function byteLength(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
}

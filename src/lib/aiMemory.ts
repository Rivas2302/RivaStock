import { supabase } from './supabase';

export type AIMemoryKind = 'fact' | 'preference' | 'summary';
export type AIMemoryStatus = 'active' | 'archived' | 'proposed';
export type AIMemoryMode = 'auto' | 'confirm' | 'off';
export type AIMemoryEventAction = 'created' | 'updated' | 'archived' | 'restored' | 'deleted' | 'used';

export interface AIMemory {
  id: string;
  kind: AIMemoryKind;
  content: string;
  source_chat_id: string | null;
  source_job_id: string | null;
  status: AIMemoryStatus;
  pinned: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  proposal_action: 'add' | 'update' | 'archive' | null;
  proposal_target_id: string | null;
}

export interface AIMemorySettings {
  mode: AIMemoryMode;
  top_k: number;
  include_summaries: boolean;
  updated_at: string | null;
}

export interface AIMemoryMetric {
  metric_date: string;
  extractions_executed: number;
  skipped_prefilter: number;
  skipped_deduplication: number;
  provider_local: number;
  provider_codex: number;
}

export interface AIMemoryOriginChat {
  id: string;
  title: string;
}

export interface AIMemoryEvent {
  id: string;
  memory_id: string;
  action: AIMemoryEventAction;
  source_job_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface AIMemoryJobActivity {
  used: Array<{ id: string; kind: AIMemoryKind; content: string }>;
  changes: Array<{
    id: string;
    memoryId: string;
    action: Extract<AIMemoryEventAction, 'created' | 'updated' | 'archived'>;
    content: string;
    canUndo: boolean;
  }>;
}

const DEFAULT_SETTINGS: AIMemorySettings = {
  mode: 'auto',
  top_k: 5,
  include_summaries: true,
  updated_at: null,
};

type QueryError = { message: string } | null;

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args as never) as unknown as {
    data: T | null;
    error: QueryError;
  };
  if (error) throw new Error(error.message);
  return data as T;
}

function throwQueryError(error: QueryError): void {
  if (error) throw new Error(error.message);
}

export async function listAIMemories(): Promise<AIMemory[]> {
  const { data, error } = await supabase.from('ai_memories')
    .select('id, kind, content, source_chat_id, source_job_id, status, pinned, use_count, last_used_at, created_at, updated_at, proposal_action, proposal_target_id')
    .in('status', ['active', 'archived', 'proposed'])
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });
  throwQueryError(error);
  return (data ?? []) as unknown as AIMemory[];
}

export async function listAIMemoryOriginChats(chatIds: string[]): Promise<AIMemoryOriginChat[]> {
  const ids = [...new Set(chatIds)].filter(isUuid);
  if (!ids.length) return [];
  const chats: AIMemoryOriginChat[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase.from('ai_chats').select('id, title')
      .in('id', ids.slice(offset, offset + 100));
    throwQueryError(error);
    chats.push(...(data ?? []) as unknown as AIMemoryOriginChat[]);
  }
  return chats;
}

export async function getAIMemorySettings(): Promise<AIMemorySettings> {
  const { data, error } = await supabase.from('ai_memory_settings')
    .select('mode, top_k, include_summaries, updated_at').maybeSingle();
  throwQueryError(error);
  return data ? data as unknown as AIMemorySettings : DEFAULT_SETTINGS;
}

export async function updateAIMemorySettings(settings: Pick<AIMemorySettings, 'mode' | 'top_k' | 'include_summaries'>): Promise<AIMemorySettings> {
  return rpc('ai_memory_update_settings', {
    p_mode: settings.mode,
    p_top_k: settings.top_k,
    p_include_summaries: settings.include_summaries,
  });
}

export async function createAIMemory(input: { kind: AIMemoryKind; content: string; pinned: boolean }): Promise<AIMemory> {
  return rpc('ai_memory_create', {
    p_kind: input.kind,
    p_content: input.content,
    p_pinned: input.kind === 'preference' && input.pinned,
  });
}

export async function updateAIMemory(input: { id: string; content: string; pinned: boolean }): Promise<AIMemory> {
  return rpc('ai_memory_update', {
    p_id: input.id,
    p_content: input.content,
    p_pinned: input.pinned,
  });
}

export async function archiveAIMemory(id: string): Promise<boolean> {
  return rpc('ai_memory_archive', { p_id: id });
}

export async function deleteAIMemory(id: string): Promise<boolean> {
  return rpc('ai_memory_delete', { p_id: id });
}

export async function undoAIMemoryEvent(eventId: string): Promise<boolean> {
  return rpc('ai_memory_undo', { p_event_id: eventId });
}

export async function reviewAIMemoryProposal(id: string, accept: boolean): Promise<boolean> {
  return rpc('ai_memory_review_proposal', { p_id: id, p_accept: accept });
}

export async function getLatestAIMemoryArchiveEvents(memoryIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(memoryIds)].filter(isUuid);
  if (!ids.length) return {};
  const { data, error } = await supabase.from('ai_memory_events')
    .select('id, memory_id, action, created_at')
    .in('memory_id', ids)
    .in('action', ['archived', 'restored', 'deleted'])
    .order('created_at', { ascending: false });
  throwQueryError(error);
  const latestAction = new Map<string, AIMemoryEventAction>();
  const latestArchiveEvent: Record<string, string> = {};
  for (const row of (data ?? []) as unknown as Array<Pick<AIMemoryEvent, 'id' | 'memory_id' | 'action'>>) {
    if (latestAction.has(row.memory_id)) continue;
    latestAction.set(row.memory_id, row.action);
    if (row.action === 'archived') latestArchiveEvent[row.memory_id] = row.id;
  }
  return latestArchiveEvent;
}

export async function getAIMemoryMetrics(days = 30): Promise<AIMemoryMetric[]> {
  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, Math.min(90, days)) + 1);
  const { data, error } = await supabase.from('ai_memory_metrics')
    .select('metric_date, extractions_executed, skipped_prefilter, skipped_deduplication, provider_local, provider_codex')
    .gte('metric_date', start.toISOString().slice(0, 10))
    .order('metric_date', { ascending: false });
  throwQueryError(error);
  return (data ?? []) as unknown as AIMemoryMetric[];
}

export async function listAIMemoryJobActivity(jobIds: string[]): Promise<Record<string, AIMemoryJobActivity>> {
  const ids = [...new Set(jobIds)].filter(isUuid);
  if (!ids.length) return {};
  const { data, error } = await supabase.from('ai_memory_events')
    .select('id, memory_id, action, source_job_id, before, after, created_at')
    .in('source_job_id', ids)
    .in('action', ['used', 'created', 'updated', 'archived'])
    .order('created_at', { ascending: true });
  throwQueryError(error);
  const events = (data ?? []) as unknown as AIMemoryEvent[];
  if (!events.length) return {};

  const memoryIds = [...new Set(events.map((event) => event.memory_id))];
  const [memoryResult, mutationResult] = await Promise.all([
    supabase.from('ai_memories').select('id, kind, content').in('id', memoryIds),
    supabase.from('ai_memory_events')
      .select('id, memory_id, action, created_at')
      .in('memory_id', memoryIds)
      .in('action', ['created', 'updated', 'archived', 'restored', 'deleted'])
      .order('created_at', { ascending: false }),
  ]);
  throwQueryError(memoryResult.error);
  throwQueryError(mutationResult.error);
  const memories = new Map((memoryResult.data ?? []).map((row) => [
    (row as unknown as Pick<AIMemory, 'id' | 'kind' | 'content'>).id,
    row as unknown as Pick<AIMemory, 'id' | 'kind' | 'content'>,
  ]));
  const latestMutation = new Map<string, string>();
  for (const row of (mutationResult.data ?? []) as unknown as Array<Pick<AIMemoryEvent, 'id' | 'memory_id'>>) {
    if (!latestMutation.has(row.memory_id)) latestMutation.set(row.memory_id, row.id);
  }
  const result: Record<string, AIMemoryJobActivity> = {};
  for (const event of events) {
    if (!event.source_job_id) continue;
    const activity = result[event.source_job_id] ??= { used: [], changes: [] };
    const memory = memories.get(event.memory_id);
    if (event.action === 'used') {
      if (!activity.used.some((item) => item.id === event.memory_id)) {
        activity.used.push({
          id: event.memory_id,
          kind: memory?.kind ?? 'fact',
          content: memory?.content ?? '',
        });
      }
      continue;
    }
    if (event.action !== 'created' && event.action !== 'updated' && event.action !== 'archived') continue;
    const snapshot = event.after ?? event.before;
    const content = typeof snapshot?.content === 'string' ? snapshot.content : memory?.content ?? '';
    activity.changes.push({
      id: event.id,
      memoryId: event.memory_id,
      action: event.action,
      content,
      canUndo: latestMutation.get(event.memory_id) === event.id && Boolean(memory),
    });
  }
  return result;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

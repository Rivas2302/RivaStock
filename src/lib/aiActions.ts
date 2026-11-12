import { supabase } from './supabase';

export interface FacebookPublishProductParams {
  product_id: string;
  marketplace: boolean;
  groups?: string[];
  group_mode: 'marketplace_groups' | 'separate';
  use_ai_copy: boolean;
  schedule_at?: string;
}

export interface AIActionRequest {
  id: string;
  action_key: 'facebook.publish_product';
  source: string;
  params: FacebookPublishProductParams;
  draft_content: {
    title: string;
    description: string;
    price: number;
    photos: string[];
    location: string;
    category: string;
    condition: 'new' | 'like_new' | 'good' | 'fair';
    schedule_at?: string | null;
  };
  created_at: string;
}

export type AIChatActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'undone';

export interface AIChatActionRequest {
  id: string;
  action_key: string;
  source: string;
  params: Record<string, unknown>;
  draft_content: {
    summary?: string;
    before?: unknown;
    after?: unknown;
    count?: number;
    samples?: unknown[];
  };
  status: AIChatActionStatus;
  result: Record<string, unknown> | null;
  undo: Record<string, unknown> | null;
  expires_at: string | null;
  executed_at: string | null;
  error: string | null;
  created_at: string;
}

export async function listPendingAIActions(): Promise<AIActionRequest[]> {
  const { data, error } = await supabase
    .from('ai_action_requests')
    .select('id, action_key, source, params, draft_content, created_at')
    .eq('action_key', 'facebook.publish_product')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error('No se pudieron cargar las acciones pendientes.');
  return (data ?? []) as unknown as AIActionRequest[];
}

export async function listAIChatActionRequests(ids: string[]): Promise<AIChatActionRequest[]> {
  const uniqueIds = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
  if (!uniqueIds.length) return [];
  const { data, error } = await supabase.from('ai_action_requests')
    .select('id, action_key, source, params, draft_content, status:action_state, result, undo, expires_at, executed_at, error, created_at')
    .in('id', uniqueIds).neq('action_key', 'facebook.publish_product');
  if (error) throw new Error('No se pudieron cargar las propuestas del chat.');
  return (data ?? []) as unknown as AIChatActionRequest[];
}

export async function listPendingAIChatActionRequests(): Promise<AIChatActionRequest[]> {
  const { data, error } = await supabase.from('ai_action_requests')
    .select('id, action_key, source, params, draft_content, status:action_state, result, undo, expires_at, executed_at, error, created_at')
    .neq('action_key', 'facebook.publish_product').eq('action_state', 'pending').gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  if (error) throw new Error('No se pudieron cargar las propuestas de IA pendientes.');
  return (data ?? []) as unknown as AIChatActionRequest[];
}

export async function cancelAIAction(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('ai_action_cancel', { p_request_id: requestId });
  if (error) throw new Error(error.message || 'No se pudo descartar la acción pendiente.');
}

export async function confirmAIChatAction(requestId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('ai_action_confirm', { p_request_id: requestId });
  if (error) throw new Error(error.message || 'No se pudo confirmar la propuesta.');
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.ok === false) throw new Error(typeof result.error === 'string' ? result.error : 'No se pudo confirmar la propuesta.');
  return result;
}

export async function undoAIChatAction(requestId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('ai_action_undo', { p_request_id: requestId });
  if (error) throw new Error(error.message || 'No se pudo deshacer la acción.');
  return (data ?? {}) as Record<string, unknown>;
}

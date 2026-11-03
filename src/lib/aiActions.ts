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

export async function listPendingAIActions(): Promise<AIActionRequest[]> {
  const { data, error } = await supabase
    .from('ai_action_requests')
    .select('id, action_key, source, params, draft_content, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error('No se pudieron cargar las acciones pendientes.');
  return (data ?? []) as unknown as AIActionRequest[];
}

export async function cancelAIAction(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_ai_action', { p_request_id: requestId });
  if (error) throw new Error(error.message || 'No se pudo descartar la acción pendiente.');
}

import { supabase } from './supabase';

export interface PlatformPlan {
  code: string;
  name: string;
  limits: Record<string, unknown>;
  is_active: boolean;
}

export interface PlatformBusiness {
  owner_uid: string;
  business_name: string | null;
  email: string;
  created_at: string;
  plan_code: string;
  status: 'trial' | 'active' | 'suspended';
  db_bytes: number;
  storage_bytes: Record<string, number>;
  storage_total_bytes: number;
  local_knowledge_bytes: number;
  store_bytes: number;
  mirror_status: string;
  files_missing: number;
  central_last_seen_at: string | null;
  plan_limits: Record<string, unknown>;
  limit_overrides: Record<string, unknown>;
  notes: string;
  can_manage_account: boolean;
  account_action_disabled_reason: string | null;
  has_business_subscription: boolean;
  business_action_disabled_reason: string | null;
  deletion_requested_at: string | null;
  deletion_scheduled_for: string | null;
  deletion_purge_started_at: string | null;
  deletion_failure: string | null;
  suspension_scheduled_for: string | null;
  suspension_notice_sent_at: string | null;
  suspension_notice_error: string | null;
}

export { platformBusinessDisplayName } from './platformAccountProtection';

export interface PlatformDashboardData {
  budgets: { db_bytes: number; storage_bytes: number; warn_ratio: number };
  live: { db_bytes: number; storage_bytes: number };
  last_snapshot_at: string | null;
  plans: PlatformPlan[];
  businesses: PlatformBusiness[];
}

export async function platformAdminRequest<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('platform-admin', { body });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        const payload = await response.clone().json() as { error?: string };
        if (payload.error) throw new Error(payload.error);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== 'Unexpected end of JSON input') throw cause;
      }
    }
    throw new Error('No se pudo completar la operación de plataforma.');
  }
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error);
  }
  return data as T;
}

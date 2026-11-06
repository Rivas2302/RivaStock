import {supabase} from './supabase';
export {isFacebookPacingRisk} from './facebookPacingPolicy';

export interface FacebookPacingPolicy {
  min_gap_seconds:number;
  jitter_pct:number;
  daily_marketplace_cap:number;
  daily_group_cap:number;
  max_groups_per_listing:number;
  repeat_group_days:number;
  quiet_hours_start:string;
  quiet_hours_end:string;
  timezone_name:string;
  warmup_until:string;
  pause_on_warning_hours:number;
  next_allowed_at:string|null;
  updated_at:string;
}

export interface FacebookPacingAlert {id:string;warning_text:string;created_at:string;trace_id:string}

export interface FacebookAccountHealth {
  policy: FacebookPacingPolicy & { health_lock_at: string | null; health_reviewed_at: string | null };
  published_today: number;
  group_posts_today: number;
  warmup_days_remaining: number;
  health_lock_active: boolean;
  health: { published_30d: number; rejected_30d: number; rejection_rate_pct: number };
  paused_groups: { id: string; name: string; url: string; reason: string | null; paused_at: string | null }[];
  recent_alerts: { id: string; warning_text: string; created_at: string }[];
}

export async function getFacebookAccountHealth():Promise<FacebookAccountHealth>{
  const {data,error}=await supabase.rpc('fb_account_health_get');
  if(error||!data)throw new Error('No se pudo cargar la salud de la cuenta.');
  return data as FacebookAccountHealth;
}

export async function reviewFacebookAccountHealth():Promise<FacebookAccountHealth>{
  const {data,error}=await supabase.rpc('fb_account_health_review');
  if(error||!data)throw new Error('No se pudo confirmar la revisión de la cuenta.');
  return data as FacebookAccountHealth;
}

export async function reactivateFacebookGroup(groupId:string):Promise<boolean>{
  const {data,error}=await supabase.rpc('facebook_group_safety_reactivate',{p_group:groupId});
  if(error||data!==true)throw new Error('No se pudo reactivar el grupo.');
  return true;
}

export async function getFacebookPacingPolicy():Promise<FacebookPacingPolicy>{
  const {data,error}=await supabase.rpc('fb_pacing_policy_get');
  if(error||!data)throw new Error('No se pudo cargar la política de ritmo.');
  return data as FacebookPacingPolicy;
}

export async function updateFacebookPacingPolicy(policy:Partial<FacebookPacingPolicy>,confirmRisk:boolean):Promise<FacebookPacingPolicy>{
  const {data,error}=await supabase.rpc('fb_pacing_policy_update',{p_policy:policy,p_confirm_risk:confirmRisk});
  if(error)throw new Error(error.message==='RISK_CONFIRMATION_REQUIRED'?'Confirmá el cambio de riesgo antes de guardar.':'No se pudo guardar la política de ritmo.');
  return data as FacebookPacingPolicy;
}

export async function getFacebookPacingAlerts():Promise<FacebookPacingAlert[]>{
  const {data,error}=await supabase.from('fb_pacing_alerts').select('id,warning_text,created_at,trace_id')
    .is('acknowledged_at',null).order('created_at',{ascending:false}).limit(10);
  if(error)throw new Error('No se pudieron cargar los avisos de Facebook.');
  return (data??[]) as FacebookPacingAlert[];
}

export async function acknowledgeFacebookPacingAlert(id:string):Promise<void>{
  const {data,error}=await supabase.rpc('fb_pacing_alert_acknowledge',{p_alert:id});
  if(error||data!==true)throw new Error('No se pudo cerrar el aviso.');
}


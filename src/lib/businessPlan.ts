import { supabase } from './supabase';
import { BUSINESS_MODULE_KEYS, normalizeBusinessModules, type BusinessModules, type BusinessModuleKey } from './businessModules';

export type { BusinessModuleKey, BusinessModules } from './businessModules';

export interface BusinessPlan {
  planCode: string;
  planName: string;
  status: 'trial' | 'active' | 'suspended';
  suspensionScheduledFor: string | null;
  limits: Record<string, unknown> & { modules: BusinessModules };
}

export function getBusinessPlanDisplayName(planCode: string, fallback = 'Plan personalizado'): string {
  if (planCode === 'base') return 'RivaStock';
  if (planCode === 'pro') return 'RivaStock IA';
  if (planCode === 'interno') return 'RivaStock Interno';
  return fallback;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; plan: BusinessPlan }>();
const inFlight = new Map<string, Promise<BusinessPlan>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBusinessPlan(value: unknown): BusinessPlan {
  if (!isRecord(value)) {
    throw new Error('La respuesta del plan del negocio no es válida.');
  }
  const limits = value.limits;
  if (!isRecord(limits)) {
    throw new Error('La respuesta del plan del negocio no es válida.');
  }
  const modules = limits.modules;
  if (!isRecord(modules)) {
    throw new Error('La respuesta del plan del negocio no es válida.');
  }

  const { plan_code, plan_name, status, suspension_scheduled_for } = value;
  if (typeof plan_code !== 'string' || typeof plan_name !== 'string'
    || !['trial', 'active', 'suspended'].includes(String(status))) {
    throw new Error('La respuesta del plan del negocio no es válida.');
  }

  if (BUSINESS_MODULE_KEYS.some(key => modules[key] !== undefined && typeof modules[key] !== 'boolean')) {
    throw new Error('La configuración de módulos del plan no es válida.');
  }

  return {
    planCode: plan_code,
    planName: getBusinessPlanDisplayName(plan_code, plan_name),
    status: status as BusinessPlan['status'],
    suspensionScheduledFor: typeof suspension_scheduled_for === 'string' ? suspension_scheduled_for : null,
    limits: {
      ...limits,
      modules: normalizeBusinessModules(modules) as BusinessModules,
    },
  };
}

export async function getMyBusinessPlan(): Promise<BusinessPlan> {
  const { data, error } = await supabase.rpc('my_business_plan');
  if (error) throw error;
  return parseBusinessPlan(data);
}

export function getBusinessPlanForOwner(ownerUid: string, forceRefresh = false): Promise<BusinessPlan> {
  if (forceRefresh) cache.delete(ownerUid);

  const existing = inFlight.get(ownerUid);
  if (existing) return existing;

  const cached = cache.get(ownerUid);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.plan);
  cache.delete(ownerUid);

  const request = getMyBusinessPlan()
    .then((plan) => {
      // An invalidated request may still resolve after a newer request starts.
      // Only the currently tracked request is allowed to repopulate the cache.
      if (inFlight.get(ownerUid) === tracked) {
        cache.set(ownerUid, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return plan;
    });
  let tracked: Promise<BusinessPlan>;
  tracked = request.finally(() => {
    if (inFlight.get(ownerUid) === tracked) inFlight.delete(ownerUid);
  });
  inFlight.set(ownerUid, tracked);
  return tracked;
}

export function invalidateBusinessPlan(ownerUid?: string): void {
  if (ownerUid) {
    cache.delete(ownerUid);
    inFlight.delete(ownerUid);
    return;
  }
  cache.clear();
  inFlight.clear();
}

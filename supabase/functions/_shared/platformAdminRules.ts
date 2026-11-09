export type BusinessStatus = 'trial' | 'active' | 'suspended';
export type BusinessPlanCode = string;

export const PLATFORM_BUSINESS_MODULE_KEYS = [
  'sales', 'quotes', 'orders', 'quickPrice', 'stock', 'intake', 'sendPhotos',
  'customers', 'suppliers', 'resellers', 'supplierOrders', 'cash', 'reports',
  'calculator', 'ai', 'knowledge', 'automation', 'traceability',
] as const;

export type PlatformBusinessModuleKey = typeof PLATFORM_BUSINESS_MODULE_KEYS[number];
type PlatformBusinessModules = Partial<Record<PlatformBusinessModuleKey, boolean>>
  & Pick<Record<PlatformBusinessModuleKey, boolean>, 'ai' | 'knowledge' | 'automation'>;

export interface BusinessLimitOverrides {
  cloud_knowledge_bytes?: number;
  local_knowledge_bytes?: number;
  trace_bytes?: number;
  trace_retention_days?: number;
  collaborators?: number;
  codex_sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  modules?: PlatformBusinessModules;
}

export function normalizePlatformEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function normalizeBusinessName(value: unknown): { name: string; lower: string } | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return null;
  return { name, lower: name.toLowerCase() };
}

export function isBusinessPlanCode(value: unknown): value is BusinessPlanCode {
  return value === 'base' || value === 'pro' || value === 'interno';
}

export function isPlanTemplateCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{1,30}$/.test(value);
}

export function isBusinessStatus(value: unknown): value is BusinessStatus {
  return value === 'trial' || value === 'active' || value === 'suspended';
}

export function effectiveBusinessStatus(status: BusinessStatus, suspensionScheduledFor: string | null, now = Date.now()): BusinessStatus {
  if (status === 'suspended') return 'suspended';
  const deadline = suspensionScheduledFor ? Date.parse(suspensionScheduledFor) : Number.NaN;
  return Number.isFinite(deadline) && deadline <= now ? 'suspended' : status;
}

export function parseBusinessLimitOverrides(value: unknown): BusinessLimitOverrides | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numericRanges: Record<string, number> = {
    cloud_knowledge_bytes: 500_000_000_000,
    local_knowledge_bytes: 5_000_000_000_000,
    trace_bytes: 500_000_000_000,
    trace_retention_days: 14,
    collaborators: 1_000,
  };
  const parsed: BusinessLimitOverrides = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key in numericRanges) {
      if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0 || entry > numericRanges[key]) return null;
      (parsed as Record<string, unknown>)[key] = entry;
      continue;
    }
    if (key === 'codex_sandbox') {
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(String(entry))) return null;
      parsed.codex_sandbox = entry as BusinessLimitOverrides['codex_sandbox'];
      continue;
    }
    if (key === 'modules') {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
      const modules = entry as Record<string, unknown>;
      if (Object.keys(modules).some((module) => !(PLATFORM_BUSINESS_MODULE_KEYS as readonly string[]).includes(module)
        || typeof modules[module] !== 'boolean')
        || !['ai', 'knowledge', 'automation'].every((module) => typeof modules[module] === 'boolean')) return null;
      parsed.modules = Object.fromEntries(Object.entries(modules)) as PlatformBusinessModules;
      continue;
    }
    return null;
  }
  return parsed;
}

export function hasReachedCollaboratorLimit(activeCount: number, limit: number): boolean {
  return Number.isSafeInteger(activeCount) && Number.isSafeInteger(limit)
    && activeCount >= 0 && limit >= 0 && activeCount >= limit;
}

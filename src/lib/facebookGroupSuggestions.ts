import type { FacebookGroup, FacebookGroupResult, FacebookPublication } from './facebookPublications';

export interface FacebookGroupPerformance {
  group_id: string;
  group_name: string;
  group_url: string;
  member_count_text: string | null;
  member_count_updated_at: string | null;
  publication_count: number;
  published_count: number;
  pending_count: number;
  rejected_count: number;
  approval_rate_pct: number | null;
  avg_approval_seconds: number | null;
  last_used_at: string | null;
  last_rejected_at: string | null;
  rejected_last_30d_count: number;
}

export interface RankedFacebookGroup {
  group: FacebookGroup;
  score: number;
  daysSinceProductUse: number | null;
  blockedUntil: string | null;
  excludedReason: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const REPEAT_GROUP_DAYS_DEFAULT = 14;
const STOP_WORDS = new Set(['con', 'del', 'las', 'los', 'para', 'por', 'una', 'uno', 'unos', 'unas', 'grupo', 'grupos', 'compra', 'venta']);

export function estimateFacebookGroupMembers(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const match = normalized.match(/\d[\d.,\s]*/);
  if (!match) return null;
  let numeric = match[0].trim().replace(/\s/g, '');
  if (numeric.includes('.') && numeric.includes(',')) {
    numeric = numeric.lastIndexOf(',') > numeric.lastIndexOf('.')
      ? numeric.replace(/\./g, '').replace(',', '.')
      : numeric.replace(/,/g, '');
  } else if (/[.,]/.test(numeric)) {
    const separator = numeric.includes(',') ? ',' : '.';
    const parts = numeric.split(separator);
    numeric = parts.length === 2 && parts[1].length === 3 ? parts.join('') : numeric.replace(separator, '.');
  }
  const count = Number.parseFloat(numeric);
  if (!Number.isFinite(count)) return null;
  const multiplier = /(?:mil\b|miles\b|k\b)/.test(normalized) ? 1_000
    : /(?:millon\b|millones\b|m\b)/.test(normalized) ? 1_000_000 : 1;
  return Math.round(count * multiplier);
}

function categoryKeywords(category: string): string[] {
  return [...new Set(category.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
    .split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !STOP_WORDS.has(word)))];
}

export function lastProductGroupUse(publications: FacebookPublication[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const publication of publications) {
    for (const delivery of publication.facebook_deliveries) {
      const usedAt = delivery.submitted_at ?? publication.approved_at;
      const groups = new Set<string>();
      for (const groupResult of delivery.fb_delivery_group_results ?? []) {
        if (groupResult.checked_at || groupResult.status !== 'pending') groups.add(groupResult.group_id);
      }
      if (delivery.submitted_at) for (const target of delivery.target_groups ?? []) groups.add(target.group_id);
      for (const groupId of groups) {
        const previous = result.get(groupId);
        if (!previous || Date.parse(usedAt) > Date.parse(previous)) result.set(groupId, usedAt);
      }
    }
  }
  return result;
}

export function rankFacebookGroups(
  groups: FacebookGroup[],
  performance: FacebookGroupPerformance[],
  category: string,
  lastProductUse: Map<string, string>,
  now = Date.now(),
  repeatGroupDays = REPEAT_GROUP_DAYS_DEFAULT,
): RankedFacebookGroup[] {
  const byId = new Map(performance.map(item => [item.group_id, item]));
  const keywords = categoryKeywords(category);
  return groups.map(group => {
    const metrics = byId.get(group.id);
    const usedAt = lastProductUse.get(group.id);
    const requiredRepeatDays = Math.max(repeatGroupDays, group.repeat_limit_days ?? 0);
    const daysSinceProductUse = usedAt ? Math.max(0, Math.floor((now - Date.parse(usedAt)) / DAY_MS)) : null;
    const blockedUntil = usedAt && daysSinceProductUse !== null && daysSinceProductUse < requiredRepeatDays
      ? new Date(Date.parse(usedAt) + requiredRepeatDays * DAY_MS).toISOString()
      : null;
    const approval = metrics?.approval_rate_pct == null ? 0.5 : Math.max(0, Math.min(100, metrics.approval_rate_pct)) / 100;
    const members = estimateFacebookGroupMembers(metrics?.member_count_text ?? group.member_count_text);
    const audience = members == null ? 0.5 : Math.min(1, Math.log10(members + 1) / Math.log10(100_001));
    const noRecentRejections = (metrics?.rejected_last_30d_count ?? 0) === 0 ? 1 : 0;
    const recency = daysSinceProductUse === null ? 1 : Math.min(1, daysSinceProductUse / 30);
    const groupKeywords = new Set(categoryKeywords(group.name));
    const categoryMatch = keywords.length ? keywords.filter(word => groupKeywords.has(word)).length / keywords.length : 0.5;
    const score = Math.round(100 * (approval * 0.35 + audience * 0.15 + noRecentRejections * 0.2 + recency * 0.2 + categoryMatch * 0.1));
    const excludedReason = group.safety_paused
      ? group.safety_pause_reason || 'Este grupo está pausado por seguridad.'
      : group.allows_sales === false ? 'Las reglas detectadas del grupo no permiten ventas.' : null;
    return { group, score, daysSinceProductUse, blockedUntil, excludedReason };
  }).sort((left, right) => Number(Boolean(left.excludedReason)) - Number(Boolean(right.excludedReason))
    || Number(Boolean(left.blockedUntil)) - Number(Boolean(right.blockedUntil))
    || right.score - left.score
    || left.group.name.localeCompare(right.group.name, 'es'));
}

export function groupResultIsRejected(result: FacebookGroupResult): boolean {
  return result.status === 'not_approved';
}

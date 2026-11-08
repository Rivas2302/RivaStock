import type { SupplierPriceRounding } from './resellerSupplierRounds';

export type ResellerMarginMode = 'percent' | 'fixed';

export interface ResellerMarginValueRule {
  mode: ResellerMarginMode;
  value: number;
  minimumProfit: number | null;
  maximumProfit: number | null;
}

export interface ResellerMarginTier extends ResellerMarginValueRule {
  id: string;
  maximumCost: number | null;
}

export interface ResellerMarginRules {
  tiers: ResellerMarginTier[];
  categoryOverrides: Record<string, ResellerMarginValueRule>;
  productOverrides: Record<string, ResellerMarginValueRule>;
  rounding: SupplierPriceRounding;
}

export interface ResellerMarginSuggestion {
  rule: ResellerMarginValueRule;
  targetProfit: number;
  suggestedResellerPrice: number;
}

const valueRule = (mode: ResellerMarginMode, value: number): ResellerMarginValueRule => ({
  mode,
  value,
  minimumProfit: null,
  maximumProfit: null,
});

export const DEFAULT_RESELLER_MARGIN_RULES: ResellerMarginRules = {
  tiers: [
    { id: 'cost-5000', maximumCost: 5_000, ...valueRule('percent', 40) },
    { id: 'cost-15000', maximumCost: 15_000, ...valueRule('percent', 30) },
    { id: 'cost-30000', maximumCost: 30_000, ...valueRule('fixed', 5_000) },
    { id: 'cost-over-30000', maximumCost: null, ...valueRule('percent', 18) },
  ],
  categoryOverrides: {},
  productOverrides: {},
  rounding: 'none',
};

export function normalizeMarginCategory(category: string | null | undefined): string {
  return (category ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es-AR');
}

export function normalizeResellerMarginRules(value: unknown): ResellerMarginRules {
  if (!value || typeof value !== 'object') return DEFAULT_RESELLER_MARGIN_RULES;
  const candidate = value as Partial<ResellerMarginRules>;
  const tiers = Array.isArray(candidate.tiers) ? candidate.tiers : [];
  const validTiers = tiers.flatMap((tier, index) => {
    if (!tier || typeof tier !== 'object') return [];
    const entry = tier as Partial<ResellerMarginTier>;
    if (entry.mode !== 'percent' && entry.mode !== 'fixed') return [];
    if (!Number.isFinite(entry.value) || Number(entry.value) < 0) return [];
    return [{
      id: typeof entry.id === 'string' && entry.id ? entry.id : `cost-tier-${index}`,
      maximumCost: Number.isFinite(entry.maximumCost) && Number(entry.maximumCost) >= 0 ? Number(entry.maximumCost) : null,
      mode: entry.mode,
      value: Number(entry.value),
      minimumProfit: Number.isFinite(entry.minimumProfit) && Number(entry.minimumProfit) >= 0 ? Number(entry.minimumProfit) : null,
      maximumProfit: Number.isFinite(entry.maximumProfit) && Number(entry.maximumProfit) >= 0 ? Number(entry.maximumProfit) : null,
    } satisfies ResellerMarginTier];
  });
  const rounding = candidate.rounding === 100 || candidate.rounding === 500 ? candidate.rounding : 'none';
  return {
    tiers: validTiers.length >= 2 ? validTiers : DEFAULT_RESELLER_MARGIN_RULES.tiers,
    categoryOverrides: normalizeOverrides(candidate.categoryOverrides),
    productOverrides: normalizeOverrides(candidate.productOverrides),
    rounding,
  };
}

export function validateResellerMarginRules(rules: ResellerMarginRules): string | null {
  if (rules.tiers.length < 2 || rules.tiers.length > 10) return 'Usá entre 2 y 10 escalones de costo.';
  if (rules.tiers[rules.tiers.length - 1]?.maximumCost !== null) return 'El último escalón debe quedar sin límite de costo.';
  let previousMaximum = -1;
  for (const tier of rules.tiers.slice(0, -1)) {
    if (tier.maximumCost === null || tier.maximumCost <= previousMaximum) return 'Los costos máximos de los escalones deben aumentar.';
    previousMaximum = tier.maximumCost;
  }
  const values = [...rules.tiers, ...Object.values(rules.categoryOverrides), ...Object.values(rules.productOverrides)];
  if (values.some(rule => !Number.isFinite(rule.value) || rule.value < 0
    || (rule.minimumProfit !== null && (!Number.isFinite(rule.minimumProfit) || rule.minimumProfit < 0))
    || (rule.maximumProfit !== null && (!Number.isFinite(rule.maximumProfit) || rule.maximumProfit < 0))
    || (rule.minimumProfit !== null && rule.maximumProfit !== null && rule.minimumProfit > rule.maximumProfit))) {
    return 'Revisá los valores de ganancia y que el mínimo no supere al máximo.';
  }
  return null;
}

function normalizeOverrides(value: unknown): Record<string, ResellerMarginValueRule> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, rawRule]) => {
    if (!rawRule || typeof rawRule !== 'object') return [];
    const rule = rawRule as Partial<ResellerMarginValueRule>;
    if ((rule.mode !== 'percent' && rule.mode !== 'fixed') || !Number.isFinite(rule.value) || Number(rule.value) < 0) return [];
    return [[key, {
      mode: rule.mode,
      value: Number(rule.value),
      minimumProfit: Number.isFinite(rule.minimumProfit) && Number(rule.minimumProfit) >= 0 ? Number(rule.minimumProfit) : null,
      maximumProfit: Number.isFinite(rule.maximumProfit) && Number(rule.maximumProfit) >= 0 ? Number(rule.maximumProfit) : null,
    } satisfies ResellerMarginValueRule]];
  }));
}

export function resolveResellerMarginRule(
  rules: ResellerMarginRules,
  input: { cost: number; productId?: string | null; category?: string | null },
): ResellerMarginValueRule {
  const productOverride = input.productId ? rules.productOverrides[input.productId] : undefined;
  if (productOverride) return productOverride;
  const categoryOverride = rules.categoryOverrides[normalizeMarginCategory(input.category)];
  if (categoryOverride) return categoryOverride;
  const tiers = [...rules.tiers].sort((left, right) => {
    if (left.maximumCost === null) return right.maximumCost === null ? 0 : 1;
    if (right.maximumCost === null) return -1;
    return left.maximumCost - right.maximumCost;
  });
  return tiers.find(tier => tier.maximumCost === null || input.cost <= tier.maximumCost) ?? tiers[tiers.length - 1];
}

export function calculateResellerMarginSuggestion(
  rules: ResellerMarginRules,
  input: { cost: number; productId?: string | null; category?: string | null },
): ResellerMarginSuggestion {
  if (!Number.isFinite(input.cost) || input.cost < 0) throw new Error('El costo debe ser un número válido.');
  const rule = resolveResellerMarginRule(rules, input);
  return calculateResellerMarginSuggestionForRule(rule, input.cost, rules.rounding);
}

export function calculateResellerMarginSuggestionForRule(
  rule: ResellerMarginValueRule,
  cost: number,
  rounding: SupplierPriceRounding = 'none',
): ResellerMarginSuggestion {
  if (!Number.isFinite(cost) || cost < 0) throw new Error('El costo debe ser un número válido.');
  if (!Number.isFinite(rule.value) || rule.value < 0) throw new Error('La ganancia objetivo debe ser un número válido.');
  let targetProfit = rule.mode === 'percent' ? cost * rule.value / 100 : rule.value;
  if (rule.minimumProfit !== null) targetProfit = Math.max(targetProfit, rule.minimumProfit);
  if (rule.maximumProfit !== null) targetProfit = Math.min(targetProfit, rule.maximumProfit);
  targetProfit = Math.round(targetProfit * 100) / 100;
  const rawPrice = cost + targetProfit;
  const suggestedResellerPrice = rounding === 'none'
    ? Math.round(rawPrice * 100) / 100
    : Math.round(rawPrice / rounding) * rounding;
  return { rule, targetProfit, suggestedResellerPrice };
}

export function selectMarginSimulatorProducts<T extends { cost: number }>(products: T[], limit = 6): T[] {
  const eligible = products.filter(product => Number.isFinite(product.cost) && product.cost > 0)
    .sort((left, right) => left.cost - right.cost);
  if (eligible.length <= limit) return eligible;
  if (limit <= 1) return [eligible[Math.floor((eligible.length - 1) / 2)]];
  return Array.from({ length: limit }, (_, index) => eligible[Math.round(index * (eligible.length - 1) / (limit - 1))]);
}

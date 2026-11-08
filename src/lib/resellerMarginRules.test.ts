import { describe, expect, it } from 'vitest';
import {
  calculateResellerMarginSuggestion,
  DEFAULT_RESELLER_MARGIN_RULES,
  normalizeMarginCategory,
  normalizeResellerMarginRules,
  resolveResellerMarginRule,
  selectMarginSimulatorProducts,
} from './resellerMarginRules';

describe('reseller margin rules', () => {
  it('uses cost bands and supports percent and fixed peso profit', () => {
    expect(calculateResellerMarginSuggestion(DEFAULT_RESELLER_MARGIN_RULES, { cost: 5_000 }).suggestedResellerPrice).toBe(7_000);
    expect(calculateResellerMarginSuggestion(DEFAULT_RESELLER_MARGIN_RULES, { cost: 15_000 }).suggestedResellerPrice).toBe(19_500);
    expect(calculateResellerMarginSuggestion(DEFAULT_RESELLER_MARGIN_RULES, { cost: 20_000 }).suggestedResellerPrice).toBe(25_000);
    expect(calculateResellerMarginSuggestion(DEFAULT_RESELLER_MARGIN_RULES, { cost: 40_000 }).suggestedResellerPrice).toBe(47_200);
  });

  it('prioritizes product overrides over category overrides over cost tiers', () => {
    const rules = normalizeResellerMarginRules({
      ...DEFAULT_RESELLER_MARGIN_RULES,
      categoryOverrides: { perfumes: { mode: 'fixed', value: 6_000 } },
      productOverrides: { 'perfume-1': { mode: 'percent', value: 50 } },
    });
    expect(resolveResellerMarginRule(rules, { cost: 16_000, category: 'Perfúmes' })).toMatchObject({ mode: 'fixed', value: 6_000 });
    expect(resolveResellerMarginRule(rules, { cost: 16_000, category: 'Perfúmes', productId: 'perfume-1' })).toMatchObject({ mode: 'percent', value: 50 });
    expect(calculateResellerMarginSuggestion(rules, { cost: 16_000, category: 'Perfumes' }).suggestedResellerPrice).toBe(22_000);
  });

  it('applies optional per-rule minimum and maximum profit in pesos', () => {
    const rules = normalizeResellerMarginRules({
      ...DEFAULT_RESELLER_MARGIN_RULES,
      tiers: [
        { id: 'zero', maximumCost: 0, mode: 'percent', value: 10, minimumProfit: null, maximumProfit: null },
        { id: 'all', maximumCost: null, mode: 'percent', value: 10, minimumProfit: 2_000, maximumProfit: 4_000 },
      ],
    });
    expect(calculateResellerMarginSuggestion(rules, { cost: 1_000 })).toMatchObject({ targetProfit: 2_000, suggestedResellerPrice: 3_000 });
    expect(calculateResellerMarginSuggestion(rules, { cost: 100_000 })).toMatchObject({ targetProfit: 4_000, suggestedResellerPrice: 104_000 });
  });

  it('rounds the suggested reseller price to exact, $100, or $500', () => {
    const rules = normalizeResellerMarginRules({
      ...DEFAULT_RESELLER_MARGIN_RULES,
      tiers: [
        { id: 'zero', maximumCost: 0, mode: 'fixed', value: 0, minimumProfit: null, maximumProfit: null },
        { id: 'all', maximumCost: null, mode: 'fixed', value: 1_234, minimumProfit: null, maximumProfit: null },
      ],
    });
    expect(calculateResellerMarginSuggestion({ ...rules, rounding: 'none' }, { cost: 1_000 }).suggestedResellerPrice).toBe(2_234);
    expect(calculateResellerMarginSuggestion({ ...rules, rounding: 100 }, { cost: 1_000 }).suggestedResellerPrice).toBe(2_200);
    expect(calculateResellerMarginSuggestion({ ...rules, rounding: 500 }, { cost: 1_000 }).suggestedResellerPrice).toBe(2_000);
  });

  it('normalizes accented categories and chooses six products across the cost range', () => {
    expect(normalizeMarginCategory('  Perfúmes  ')).toBe('perfumes');
    const products = Array.from({ length: 20 }, (_, index) => ({ id: `${index}`, cost: (index + 1) * 1_000 }));
    expect(selectMarginSimulatorProducts(products)).toHaveLength(6);
    expect(selectMarginSimulatorProducts(products).map(product => product.cost)).toEqual([1_000, 5_000, 9_000, 12_000, 16_000, 20_000]);
    expect(selectMarginSimulatorProducts(products.slice(0, 2))).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { getCommercialRuleMessage, isCommercialRuleSatisfied } from './commercialRules';

describe('commercial reseller rules', () => {
  it('accepts every order when no minimum is configured', () => {
    expect(isCommercialRuleSatisfied({
      minimumRule: 'none',
      minimumOrderAmount: 50000,
      minimumOrderQuantity: 10,
    }, 0, 0)).toBe(true);
  });

  it('enforces amount and quantity together', () => {
    const rule = {
      minimumRule: 'both' as const,
      minimumOrderAmount: 50000,
      minimumOrderQuantity: 10,
    };
    expect(isCommercialRuleSatisfied(rule, 50000, 9)).toBe(false);
    expect(isCommercialRuleSatisfied(rule, 49999, 10)).toBe(false);
    expect(isCommercialRuleSatisfied(rule, 50000, 10)).toBe(true);
  });

  it('describes the configured rule for catalog and PDF copy', () => {
    expect(getCommercialRuleMessage({
      minimumRule: 'quantity',
      minimumOrderAmount: 0,
      minimumOrderQuantity: 6,
    })).toBe('Compra mínima: 6 unidades');
  });
});

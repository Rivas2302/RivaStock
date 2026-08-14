import { describe, expect, it } from 'vitest';
import { getResellerPricingAdvice } from './resellerPricingAdvisor';

const base = {
  retailPrice: 100_000,
  purchaseCost: 60_000,
  currentResellerPrice: 80_000,
  minimumOwnerMarginPercent: 25,
  targetResellerDiscountPercent: 15,
};

describe('reseller pricing advisor', () => {
  it('recognizes a balanced price', () => {
    const advice = getResellerPricingAdvice(base);
    expect(advice.status).toBe('balanced');
    expect(advice.currentOwnerMarginPercent).toBe(25);
    expect(advice.currentResellerMarginPercent).toBe(20);
    expect(advice.maximumSafeDiscountPercent).toBe(20);
  });

  it('raises a price that would sell at a loss', () => {
    const advice = getResellerPricingAdvice({ ...base, currentResellerPrice: 55_000 });
    expect(advice.status).toBe('loss');
    expect(advice.suggestedPrice).toBe(80_000);
    expect(advice.suggestedDiscountPercent).toBe(20);
  });

  it('protects the configured owner margin', () => {
    const advice = getResellerPricingAdvice({ ...base, currentResellerPrice: 75_000 });
    expect(advice.status).toBe('low_margin');
    expect(advice.suggestedPrice).toBe(80_000);
  });

  it('suggests a more attractive discount when it is safe', () => {
    const advice = getResellerPricingAdvice({ ...base, purchaseCost: 40_000, currentResellerPrice: 95_000 });
    expect(advice.status).toBe('not_competitive');
    expect(advice.suggestedDiscountPercent).toBe(15);
    expect(advice.suggestedPrice).toBe(85_000);
  });

  it('warns when the product cannot support the target reseller discount', () => {
    const advice = getResellerPricingAdvice({ ...base, purchaseCost: 70_000, currentResellerPrice: 95_000 });
    expect(advice.status).toBe('not_competitive');
    expect(advice.maximumSafeDiscountPercent).toBeLessThan(15);
    expect(advice.message).toContain('Evaluá excluirlo');
  });

  it('does not invent advice when cost is missing', () => {
    expect(getResellerPricingAdvice({ ...base, purchaseCost: 0 }).status).toBe('missing_cost');
  });

  it('does not offer a discount when retail price cannot protect the owner target', () => {
    const advice = getResellerPricingAdvice({
      ...base,
      purchaseCost: 90_000,
      currentResellerPrice: 95_000,
    });
    expect(advice.status).toBe('not_competitive');
    expect(advice.suggestedDiscountPercent).toBeNull();
    expect(advice.suggestedPrice).toBe(120_000);
  });
});

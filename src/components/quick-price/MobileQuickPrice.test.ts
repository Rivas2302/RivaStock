import { describe, expect, it } from 'vitest';
import { quickPriceStockLabel } from './MobileQuickPrice';

describe('quickPriceStockLabel', () => {
  it('distinguishes empty, last unit, and multiple units', () => {
    expect(quickPriceStockLabel(0).label).toBe('Sin stock');
    expect(quickPriceStockLabel(1).label).toBe('Queda 1');
    expect(quickPriceStockLabel(4).label).toBe('4 disponibles');
  });

  it('uses a warning tone for the last unit and success tone for available stock', () => {
    expect(quickPriceStockLabel(1).tone).toContain('amber');
    expect(quickPriceStockLabel(2).tone).toContain('emerald');
  });
});

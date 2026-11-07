import { describe, expect, it } from 'vitest';
import { calculateSupplierSuggestedPrice, getSupplierRoundState, summarizeSupplierRound } from './resellerSupplierRounds';

describe('supplier order round helpers', () => {
  it('calculates a custom margin before applying the selected rounding', () => {
    expect(calculateSupplierSuggestedPrice(10_000, 18)).toBe(11_800);
    expect(calculateSupplierSuggestedPrice(10_000, 33, 100)).toBe(13_300);
    expect(calculateSupplierSuggestedPrice(10_000, 33, 500)).toBe(13_500);
    expect(calculateSupplierSuggestedPrice(10_000, 18, 'none')).toBe(11_800);
  });

  it('rejects invalid margin and supplier cost inputs', () => {
    expect(() => calculateSupplierSuggestedPrice(-1, 20)).toThrow('costo');
    expect(() => calculateSupplierSuggestedPrice(100, Number.NaN)).toThrow('margen');
  });

  it('consolidates only paid orders and calculates the profit', () => {
    const result = summarizeSupplierRound([
      { id: 'paid-1', resellerName: 'Revendedora A', paidAt: '2026-11-06T12:00:00Z', items: [
        { productId: 'p1', productName: 'Taza', quantity: 2, supplierUnitCost: 1_000, resellerUnitPrice: 1_300 },
      ] },
      { id: 'unpaid', resellerName: 'Revendedor B', paidAt: null, items: [
        { productId: 'p1', productName: 'Taza', quantity: 8, supplierUnitCost: 1_000, resellerUnitPrice: 1_300 },
      ] },
      { id: 'paid-2', resellerName: 'Revendedor C', paidAt: '2026-11-06T12:10:00Z', items: [
        { productId: 'p1', productName: 'Taza', quantity: 1, supplierUnitCost: 1_000, resellerUnitPrice: 1_300 },
        { productId: 'p2', productName: 'Vaso', quantity: 3, supplierUnitCost: 500, resellerUnitPrice: 700 },
      ] },
    ]);

    expect(result).toEqual({
      paidOrderCount: 2,
      unpaidOrderCount: 1,
      supplierTotal: 4_500,
      resellerTotal: 6_000,
      profit: 1_500,
      lines: [
        { productId: 'p1', productName: 'Taza', quantity: 3, supplierUnitCost: 1_000, resellerUnitPrice: 1_300, supplierTotal: 3_000, resellerTotal: 3_900 },
        { productId: 'p2', productName: 'Vaso', quantity: 3, supplierUnitCost: 500, resellerUnitPrice: 700, supplierTotal: 1_500, resellerTotal: 2_100 },
      ],
    });
  });

  it('closes an open round at or after its cutoff and leaves drafts closed', () => {
    const now = new Date('2026-11-06T17:00:00Z');
    expect(getSupplierRoundState('open', '2026-11-06T17:00:00Z', now)).toBe('closed');
    expect(getSupplierRoundState('open', '2026-11-06T18:00:00Z', now)).toBe('open');
    expect(getSupplierRoundState('draft', '2026-11-06T18:00:00Z', now)).toBe('draft');
  });
});

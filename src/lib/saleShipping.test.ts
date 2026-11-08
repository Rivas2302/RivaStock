import { describe, expect, it } from 'vitest';
import { calculateTotalWithShipping } from './saleShipping';

describe('sale shipping totals', () => {
  it('adds shipping after the product subtotal and signed adjustment', () => {
    const baseTotal = 10_000 - 1_000 + 500;
    expect(calculateTotalWithShipping(baseTotal, false, 1_200)).toBe(9_500);
    expect(calculateTotalWithShipping(baseTotal, true, 1_200)).toBe(10_700);
  });

  it('rounds the final amount and ignores invalid or negative shipping', () => {
    expect(calculateTotalWithShipping(1_000.105, true, 2.105)).toBe(1_002.21);
    expect(calculateTotalWithShipping(1_000, true, Number.NaN)).toBe(1_000);
    expect(calculateTotalWithShipping(1_000, true, -50)).toBe(1_000);
  });

});

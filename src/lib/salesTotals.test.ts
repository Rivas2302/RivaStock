import { describe, expect, it } from 'vitest';
import { calculateSaleTotals } from './salesTotals';

describe('calculateSaleTotals', () => {
  it('shows the same subtotal with a discount or a surcharge and keeps signed totals', () => {
    expect(calculateSaleTotals(2, 1000, -300)).toEqual({ subtotal: 2000, adjustment: -300, total: 1700 });
    expect(calculateSaleTotals(2, 1000, 300)).toEqual({ subtotal: 2000, adjustment: 300, total: 2300 });
  });

  it('treats empty numeric values as zero', () => {
    expect(calculateSaleTotals(2, 1000, 0)).toEqual({ subtotal: 2000, adjustment: 0, total: 2000 });
  });
});

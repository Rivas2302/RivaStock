// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { calculateCartTotals } from './pos-cart';

describe('calculateCartTotals', () => {
  const items = [{
    productId: 'product-1',
    productName: 'Producto',
    unitPrice: 1000,
    quantity: 2,
    stockAtAdd: 5,
    lineDiscount: 0,
  }];

  it('applies a signed global adjustment without changing the cart subtotal', () => {
    expect(calculateCartTotals({ items, globalAdjustment: -300 })).toEqual({
      linesSubtotal: 2000,
      total: 1700,
      itemCount: 2,
    });
    expect(calculateCartTotals({ items, globalAdjustment: 300 })).toEqual({
      linesSubtotal: 2000,
      total: 2300,
      itemCount: 2,
    });
  });

  it('keeps the total at zero when the discount exceeds the subtotal', () => {
    expect(calculateCartTotals({ items, globalAdjustment: -2500 }).total).toBe(0);
  });
});

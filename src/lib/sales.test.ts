import { describe, expect, it } from 'vitest';

import type { Sale } from '../types';
import { getSalesPageEditPlan } from './sales';

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale',
    date: '2026-08-02',
    productId: 'product-a',
    productName: 'Product A',
    unitPrice: 10,
    quantity: 1,
    adjustment: 0,
    total: 10,
    status: 'Pagado',
    ownerUid: 'account',
    source: 'manual',
    ...overrides,
  };
}

describe('sales page edit routing', () => {
  it('routes a manual sale to the scalar legacy writer', () => {
    expect(getSalesPageEditPlan(sale())).toEqual({ allowed: true, rpc: 'edit_sale' });
  });

  it('routes a single-line POS sale to the line-aware writer', () => {
    expect(getSalesPageEditPlan(sale({
      source: 'pos',
      items: [{ productId: 'product-a', productName: 'Product A', quantity: 1, price: 10 }],
    }))).toEqual({ allowed: true, rpc: 'edit_pos_sale' });
  });

  it('blocks scalar editing of a multi-line POS sale with an explicit recovery message', () => {
    expect(getSalesPageEditPlan(sale({
      source: 'pos',
      items: [
        { productId: 'product-a', productName: 'Product A', quantity: 1, price: 10 },
        { productId: 'product-b', productName: 'Product B', quantity: 2, price: 5 },
      ],
    }))).toEqual({
      allowed: false,
      reason: 'Esta venta POS tiene varios productos. Para conservar sus lineas y stock, elimina la venta y volve a registrarla desde el POS.',
    });
  });

  it('keeps quote-derived sales read-only from the sales page', () => {
    expect(getSalesPageEditPlan(sale({ source: 'quote' }))).toEqual({
      allowed: false,
      reason: 'Las ventas creadas desde presupuestos se editan desde el presupuesto original.',
    });
  });
});

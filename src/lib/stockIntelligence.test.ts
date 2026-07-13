import { describe, expect, it } from 'vitest';
import { getRestockRecommendations } from './stockIntelligence';
import type { Product, Sale } from '../types';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1',
  ownerUid: 'owner-1',
  name: 'Producto base',
  categoryId: 'category-1',
  category: 'General',
  purchasePrice: 100,
  salePrice: 200,
  stock: 2,
  minStock: 3,
  showInCatalog: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
});

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  id: 'sale-1',
  ownerUid: 'owner-1',
  date: '2026-07-01',
  productId: 'product-1',
  productName: 'Producto base',
  unitPrice: 200,
  quantity: 1,
  adjustment: 0,
  total: 200,
  status: 'Pagado',
  ...overrides,
});

describe('getRestockRecommendations', () => {
  it('uses recent paid itemized sales to calculate coverage and suggested quantity', () => {
    const result = getRestockRecommendations(
      [product()],
      [sale({ items: [{ productId: 'product-1', productName: 'Producto base', quantity: 10, price: 200 }] })],
      new Date('2026-07-12T12:00:00'),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      unitsSoldLast30Days: 10,
      targetStock: 6,
      suggestedQuantity: 4,
      estimatedCost: 400,
      priority: 'high',
    });
    expect(result[0].coverageDays).toBeCloseTo(6);
  });

  it('ignores unpaid and stale sales', () => {
    const result = getRestockRecommendations(
      [product({ stock: 6, minStock: 3 })],
      [sale({ status: 'Pendiente' }), sale({ date: '2026-05-01', quantity: 20 })],
      new Date('2026-07-12T12:00:00'),
    );

    expect(result).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import type { InventoryHolding, Product } from '../types';
import {
  allocateHoldingStock,
  holdingFromLegacyProduct,
  inventoryHoldingCacheKey,
} from './inventoryHoldings';

function holding(overrides: Partial<InventoryHolding> = {}): InventoryHolding {
  return {
    id: 'holding-main',
    ownerUid: 'account',
    productId: 'product',
    inventoryOwnerId: 'main',
    stock: 3,
    purchaseCost: 10,
    minStock: 1,
    active: true,
    ownerSortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product',
    name: 'Mate',
    categoryId: 'category',
    category: 'Bazar',
    purchasePrice: 10,
    salePrice: 20,
    stock: 4,
    minStock: 1,
    showInCatalog: true,
    ownerUid: 'account',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('holding allocation', () => {
  it('uses the actor default first and then owner priority deterministically', () => {
    const holdings = [
      holding({ id: 'b', inventoryOwnerId: 'second', stock: 4, ownerSortOrder: 1 }),
      holding({ id: 'a', inventoryOwnerId: 'main', stock: 2, ownerSortOrder: 0 }),
      holding({ id: 'c', inventoryOwnerId: 'default', stock: 1, ownerSortOrder: 2 }),
    ];

    expect(allocateHoldingStock(holdings, 5, { defaultOwnerId: 'default' })).toEqual([
      { holdingId: 'c', inventoryOwnerId: 'default', quantity: 1 },
      { holdingId: 'a', inventoryOwnerId: 'main', quantity: 2 },
      { holdingId: 'b', inventoryOwnerId: 'second', quantity: 2 },
    ]);
  });

  it('honors an explicit owner and rejects inactive or insufficient holdings', () => {
    const holdings = [
      holding({ id: 'main', inventoryOwnerId: 'main', stock: 5 }),
      holding({ id: 'mama', inventoryOwnerId: 'mama', stock: 2, ownerSortOrder: 1 }),
      holding({ id: 'archived', inventoryOwnerId: 'old', stock: 9, active: false }),
    ];

    expect(allocateHoldingStock(holdings, 2, { preferredOwnerId: 'mama' })).toEqual([
      { holdingId: 'mama', inventoryOwnerId: 'mama', quantity: 2 },
    ]);
    expect(() => allocateHoldingStock(holdings, 3, { preferredOwnerId: 'mama' }))
      .toThrow('Stock insuficiente');
    expect(() => allocateHoldingStock(holdings, 20)).toThrow('Stock insuficiente');
  });
});

describe('legacy holding compatibility', () => {
  it('maps a 0031 product to its assigned owner without changing its economics', () => {
    expect(holdingFromLegacyProduct(product({ inventoryOwnerId: 'mama' }), 'main')).toMatchObject({
      ownerUid: 'account',
      productId: 'product',
      inventoryOwnerId: 'mama',
      stock: 4,
      purchaseCost: 10,
      minStock: 1,
      active: true,
    });
  });

  it('falls back to the primary owner and generates owner-isolated cache keys', () => {
    expect(holdingFromLegacyProduct(product(), 'main').inventoryOwnerId).toBe('main');
    expect(inventoryHoldingCacheKey('account', 'product', 'main'))
      .toBe('inventory_holdings:account:product:main');
    expect(inventoryHoldingCacheKey('account', 'product', 'mama'))
      .toBe('inventory_holdings:account:product:mama');
  });
});

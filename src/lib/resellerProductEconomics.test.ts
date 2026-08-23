import { describe, expect, it } from 'vitest';
import type { InventoryHolding, Product } from '../types';
import { getResellerProductEconomics } from './resellerProductEconomics';

const product = {
  id: 'product-1',
  purchasePrice: 16800,
} as Product;

const holding = (overrides: Partial<InventoryHolding>): InventoryHolding => ({
  id: crypto.randomUUID(),
  ownerUid: 'owner-1',
  productId: product.id,
  inventoryOwnerId: 'inventory-owner-1',
  stock: 0,
  purchaseCost: 0,
  minStock: 0,
  active: true,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  ...overrides,
});

describe('reseller product economics', () => {
  it('uses the supplier catalog cost before the product enters inventory', () => {
    expect(getResellerProductEconomics({
      ...product,
      catalogOnly: true,
      catalogCost: 12000,
    }, [], true)).toEqual({
      purchaseCost: 12000,
      purchaseCostRange: [12000, 12000],
      hasMixedPurchaseCosts: false,
      costBasis: 'catalog',
    });
  });

  it('ignores empty holdings without stock when calculating the current unit cost', () => {
    expect(getResellerProductEconomics(product, [
      holding({ inventoryOwnerId: 'principal', stock: 1, purchaseCost: 16800 }),
      holding({ inventoryOwnerId: 'secondary', stock: 0, purchaseCost: 0 }),
    ], true)).toEqual({
      purchaseCost: 16800,
      purchaseCostRange: [16800, 16800],
      hasMixedPurchaseCosts: false,
      costBasis: 'current_stock',
    });
  });

  it('uses the highest current cost and exposes when stocked units have different costs', () => {
    expect(getResellerProductEconomics(product, [
      holding({ inventoryOwnerId: 'principal', stock: 1, purchaseCost: 15000 }),
      holding({ inventoryOwnerId: 'secondary', stock: 2, purchaseCost: 16800 }),
    ], true)).toEqual({
      purchaseCost: 16800,
      purchaseCostRange: [15000, 16800],
      hasMixedPurchaseCosts: true,
      costBasis: 'current_stock',
    });
  });

  it('uses the highest recorded cost for on-order products without current stock', () => {
    expect(getResellerProductEconomics(product, [
      holding({ purchaseCost: 14000 }),
      holding({ purchaseCost: 16000 }),
    ], true)).toMatchObject({
      purchaseCost: 16000,
      purchaseCostRange: [14000, 16000],
      hasMixedPurchaseCosts: true,
      costBasis: 'last_known',
    });
  });

  it('refuses to promise a profit when a stocked unit has no purchase cost', () => {
    expect(getResellerProductEconomics(product, [
      holding({ stock: 1, purchaseCost: 16800 }),
      holding({ stock: 1, purchaseCost: 0 }),
    ], true)).toMatchObject({
      purchaseCost: null,
      purchaseCostRange: null,
      costBasis: 'missing',
    });
  });
});

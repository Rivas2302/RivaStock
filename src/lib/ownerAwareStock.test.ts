import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import type { InventoryHolding, InventoryOwner, Product } from '../types';
import {
  buildHoldingDrafts,
  filterProductsByHoldingOwner,
  getVisibleHoldingEconomics,
  getVisibleInventoryHoldings,
  hydrateSharedInventoryProduct,
  summarizeProductHoldings,
  validateHoldingDrafts,
} from './inventoryHoldings';

const owners: InventoryOwner[] = [
  { id: 'leo', ownerUid: 'account', name: 'Leo', sortOrder: 0, isPrimary: true, archivedAt: null, createdAt: '', updatedAt: '' },
  { id: 'mama', ownerUid: 'account', name: 'Mamá', sortOrder: 1, isPrimary: false, archivedAt: null, createdAt: '', updatedAt: '' },
];

const product = { id: 'mate', name: 'Mate', stock: 4 } as Product;
const holdings: InventoryHolding[] = [
  { id: 'h1', ownerUid: 'account', productId: 'mate', inventoryOwnerId: 'leo', stock: 2, purchaseCost: 10, minStock: 1, active: true, createdAt: '', updatedAt: '' },
  { id: 'h2', ownerUid: 'account', productId: 'mate', inventoryOwnerId: 'mama', stock: 2, purchaseCost: 12, minStock: 0, active: true, createdAt: '', updatedAt: '' },
];

describe('owner-aware product stock', () => {
  it('builds one editable draft per owner and preserves existing economics', () => {
    expect(buildHoldingDrafts(owners, holdings)).toEqual([
      { inventoryOwnerId: 'leo', stock: 2, purchaseCost: 10, minStock: 1, active: true },
      { inventoryOwnerId: 'mama', stock: 2, purchaseCost: 12, minStock: 0, active: true },
    ]);
  });

  it('initializes missing owners with zero stock without duplicating the product', () => {
    expect(buildHoldingDrafts(owners, holdings.slice(0, 1))[1]).toEqual({
      inventoryOwnerId: 'mama', stock: 0, purchaseCost: 0, minStock: 0, active: true,
    });
    expect(summarizeProductHoldings(product, holdings)).toMatchObject({
      productId: 'mate', combinedStock: 4, activeOwnerCount: 2,
    });
  });

  it('filters the shared product by any matching holding owner', () => {
    expect(filterProductsByHoldingOwner([product], holdings, 'mama').map((item) => item.id))
      .toEqual(['mate']);
    expect(filterProductsByHoldingOwner([product], holdings, 'missing')).toEqual([]);
  });

  it('shows only products backed by a visible holding when the owner filter is all', () => {
    expect(filterProductsByHoldingOwner([product], holdings, 'all').map((item) => item.id))
      .toEqual(['mate']);
    expect(filterProductsByHoldingOwner([product], [], 'all')).toEqual([]);
  });

  it('uses the selected holding economics instead of legacy product economics', () => {
    expect(getVisibleHoldingEconomics(product, holdings, 'mama')).toEqual({
      stock: 2,
      minStock: 0,
      purchaseCost: 12,
      purchaseCostRange: [12, 12],
      hasMixedPurchaseCosts: false,
    });
    expect(getVisibleInventoryHoldings(holdings, 'mama').map((holding) => holding.id))
      .toEqual(['h2']);
  });

  it('aggregates stock and minimum honestly and exposes a cost range in the all view', () => {
    expect(getVisibleHoldingEconomics(product, holdings, 'all')).toEqual({
      stock: 4,
      minStock: 1,
      purchaseCost: null,
      purchaseCostRange: [10, 12],
      hasMixedPurchaseCosts: true,
    });
    expect(getVisibleHoldingEconomics(product, [holdings[0]], 'all')).toMatchObject({
      stock: 2,
      minStock: 1,
      purchaseCost: 10,
      purchaseCostRange: [10, 10],
      hasMixedPurchaseCosts: false,
    });
  });

  it('hydrates an owner-aware product from shared fields without trusting mirror economics', () => {
    const sharedProjection = {
      id: 'mate',
      ownerUid: 'account',
      name: 'Mate',
      categoryId: 'category',
      category: 'General',
      salePrice: 30,
      stock: 4,
      showInCatalog: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      purchasePrice: 999,
      minStock: 99,
      inventoryOwnerId: 'hidden-owner',
    };

    expect(hydrateSharedInventoryProduct(sharedProjection)).toMatchObject({
      id: 'mate',
      salePrice: 30,
      stock: 4,
      purchasePrice: 0,
      minStock: 0,
    });
    expect(hydrateSharedInventoryProduct(sharedProjection).inventoryOwnerId).toBeUndefined();
  });

  it('rejects invalid or duplicate owner drafts', () => {
    expect(() => validateHoldingDrafts([
      { inventoryOwnerId: 'leo', stock: 2, purchaseCost: 10, minStock: 0, active: true },
      { inventoryOwnerId: 'leo', stock: 1, purchaseCost: 10, minStock: 0, active: true },
    ])).toThrow('titular repetido');
    expect(() => validateHoldingDrafts([
      { inventoryOwnerId: 'mama', stock: -1, purchaseCost: 10, minStock: 0, active: true },
    ])).toThrow('valores inválidos');
  });
});

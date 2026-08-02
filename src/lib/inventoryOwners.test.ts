import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import type { InventoryOwner, Product } from '../types';
import {
  getActiveInventoryOwners,
  getAssignableInventoryOwners,
  getInventoryOwnerName,
  getInventoryOwnerProductLabel,
  getPrimaryInventoryOwner,
  resolveInventoryOwner,
  sortInventoryOwners,
} from './inventoryOwners';

const owners: InventoryOwner[] = [
  {
    id: 'mama', ownerUid: 'account', name: 'Mamá', sortOrder: 1, isPrimary: false,
    archivedAt: null, createdAt: '2026-01-02', updatedAt: '2026-01-02',
  },
  {
    id: 'legacy', ownerUid: 'account', name: 'Anterior', sortOrder: 2, isPrimary: false,
    archivedAt: '2026-02-01', createdAt: '2026-01-03', updatedAt: '2026-02-01',
  },
  {
    id: 'main', ownerUid: 'account', name: 'Principal', sortOrder: 0, isPrimary: true,
    archivedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  },
];

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product', name: 'Mate', categoryId: 'category', category: 'Bazar',
    purchasePrice: 10, salePrice: 20, stock: 1, minStock: 0, showInCatalog: true,
    ownerUid: 'account', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('inventory owner resolution', () => {
  it('resolves explicit, primary and legacy products without denormalizing the name', () => {
    expect(resolveInventoryOwner(product({ inventoryOwnerId: 'mama' }), owners)?.name).toBe('Mamá');
    expect(getPrimaryInventoryOwner(owners)?.id).toBe('main');
    expect(resolveInventoryOwner(product({ inventoryOwnerId: undefined }), owners)?.id).toBe('main');
    expect(getInventoryOwnerName(product({ inventoryOwnerId: 'missing' }), owners)).toBe('');
    expect(product({ inventoryOwnerId: 'mama' })).not.toHaveProperty('inventoryOwnerName');
  });

  it('falls back to the first active priority when no primary flag exists', () => {
    const withoutPrimary = owners.map((owner) => ({ ...owner, isPrimary: false }));
    expect(getPrimaryInventoryOwner(withoutPrimary)?.id).toBe('main');
  });
});

describe('inventory owner availability', () => {
  it('sorts active owners first and excludes archived owners from new assignments', () => {
    expect(sortInventoryOwners(owners).map((owner) => owner.id)).toEqual(['main', 'mama', 'legacy']);
    expect(getActiveInventoryOwners(owners).map((owner) => owner.id)).toEqual(['main', 'mama']);
    expect(getAssignableInventoryOwners(owners).map((owner) => owner.id)).toEqual(['main', 'mama']);
  });

  it('keeps the currently assigned archived owner available while editing', () => {
    expect(getAssignableInventoryOwners(owners, 'legacy').map((owner) => owner.id))
      .toEqual(['main', 'mama', 'legacy']);
  });
});

describe('inventory owner product labels', () => {
  it('disambiguates products with the same name by merchandise owner', () => {
    const ownProduct = product({ id: 'own', inventoryOwnerId: 'main' });
    const familyProduct = product({ id: 'family', inventoryOwnerId: 'mama' });

    expect(getInventoryOwnerProductLabel(ownProduct, owners)).toBe('Mate — Principal');
    expect(getInventoryOwnerProductLabel(familyProduct, owners)).toBe('Mate — Mamá');
  });
});

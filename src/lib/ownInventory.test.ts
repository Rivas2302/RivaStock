import { describe, expect, it } from 'vitest';
import { filterOwnInventoryProducts, isOwnInventoryProduct } from './ownInventory';
import type { Product } from '../types';

const product = (id: string, catalogOnly = false): Product => ({
  id,
  name: id,
  categoryId: 'category',
  category: 'Category',
  purchasePrice: 10,
  salePrice: 20,
  stock: 0,
  minStock: 0,
  showInCatalog: true,
  catalogOnly,
  ownerUid: 'owner',
  createdAt: '',
  updatedAt: '',
});

describe('own inventory products', () => {
  it('excludes supplier catalog products and retains own products without requiring stock', () => {
    const own = product('own');
    const supplier = product('supplier', true);

    expect(isOwnInventoryProduct(own)).toBe(true);
    expect(isOwnInventoryProduct(supplier)).toBe(false);
    expect(filterOwnInventoryProducts([own, supplier]).map((item) => item.id)).toEqual(['own']);
  });

  it('treats legacy products without catalogOnly as own inventory', () => {
    expect(isOwnInventoryProduct({ catalogOnly: undefined })).toBe(true);
  });
});

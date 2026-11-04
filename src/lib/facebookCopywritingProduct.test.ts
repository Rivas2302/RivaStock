import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { resolveFacebookCopywritingProduct } from './facebookCopywritingProduct';

const product = (id: string): Product => ({
  id,
  name: 'Cable USB C',
  category: 'Cargadores',
  categoryId: 'chargers',
  purchasePrice: 100,
  salePrice: 250,
  stock: 2,
  minStock: 0,
  images: [],
  showInCatalog: true,
  ownerUid: 'owner-1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

describe('resolveFacebookCopywritingProduct', () => {
  it('uses the stored id when products have identical display details', () => {
    const selected = product('product-2');
    const result = resolveFacebookCopywritingProduct(JSON.stringify({
      product: { id: selected.id, name: selected.name, category: selected.category, price: selected.salePrice },
    }), [product('product-1'), selected]);

    expect(result).toEqual({ kind: 'match', product: selected });
  });

  it('keeps the unique snapshot fallback for tasks created before product ids were stored', () => {
    const selected = product('product-1');
    const result = resolveFacebookCopywritingProduct(JSON.stringify({
      product: { name: selected.name, category: selected.category, price: selected.salePrice },
    }), [selected]);

    expect(result).toEqual({ kind: 'match', product: selected });
  });

  it('reports ambiguity for a legacy task without an id when products duplicate its snapshot', () => {
    const result = resolveFacebookCopywritingProduct(JSON.stringify({
      product: { name: 'Cable USB C', category: 'Cargadores', price: 250 },
    }), [product('product-1'), product('product-2')]);

    expect(result).toEqual({ kind: 'ambiguous' });
  });

  it('does not fall back to a similarly named product when a stored id is gone', () => {
    const result = resolveFacebookCopywritingProduct(JSON.stringify({
      product: { id: 'deleted-product', name: 'Cable USB C', category: 'Cargadores', price: 250 },
    }), [product('product-1')]);

    expect(result).toEqual({ kind: 'missing' });
  });
});

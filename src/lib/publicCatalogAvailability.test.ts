import { describe, expect, it } from 'vitest';
import type { PublicCatalogProduct } from '../types';
import { matchesResellerAvailabilityFilter } from './publicCatalogAvailability';

const product = (availability: PublicCatalogProduct['availability']): PublicCatalogProduct => ({
  id: availability,
  name: availability,
  categoryId: 'category-1',
  category: 'General',
  purchasePrice: 0,
  salePrice: 100,
  stock: availability === 'in_stock' ? 2 : 0,
  minStock: 0,
  showInCatalog: true,
  ownerUid: 'owner-1',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  availability,
});

describe('reseller public catalog availability filter', () => {
  it('shows every public product by default', () => {
    expect(matchesResellerAvailabilityFilter(product('in_stock'), 'all')).toBe(true);
    expect(matchesResellerAvailabilityFilter(product('on_order'), 'all')).toBe(true);
  });

  it('separates immediate stock from on-order products', () => {
    expect(matchesResellerAvailabilityFilter(product('in_stock'), 'in_stock')).toBe(true);
    expect(matchesResellerAvailabilityFilter(product('on_order'), 'in_stock')).toBe(false);
    expect(matchesResellerAvailabilityFilter(product('on_order'), 'on_order')).toBe(true);
    expect(matchesResellerAvailabilityFilter(product('in_stock'), 'on_order')).toBe(false);
  });
});

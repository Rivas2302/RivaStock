import type { PublicCatalogProduct } from '../types';

export type ResellerAvailabilityFilter = 'all' | 'in_stock' | 'on_order';

export function matchesResellerAvailabilityFilter(
  product: PublicCatalogProduct,
  filter: ResellerAvailabilityFilter,
): boolean {
  return filter === 'all' || product.availability === filter;
}

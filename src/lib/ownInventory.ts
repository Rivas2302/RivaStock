import type { Product } from '../types';

/** True when a product belongs to the business's own stock rather than a supplier catalog. */
export function isOwnInventoryProduct(product: Pick<Product, 'catalogOnly'>): boolean {
  return product.catalogOnly !== true;
}

export function filterOwnInventoryProducts<T extends Pick<Product, 'catalogOnly'>>(products: T[]): T[] {
  return products.filter(isOwnInventoryProduct);
}

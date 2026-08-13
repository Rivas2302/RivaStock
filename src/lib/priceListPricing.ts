import type { PriceList, PriceListAvailability, PriceListItem, Product } from '../types';
import { roundPrice } from './utils';

export const clampPriceListDiscount = (value: number): number => (
  Math.min(100, Math.max(0, value))
);

export function resolvePriceListPrice(
  basePrice: number,
  defaultDiscountPercent: number,
  item: Pick<PriceListItem, 'pricingMode' | 'discountPercent' | 'fixedPrice'>,
): number {
  if (item.pricingMode === 'fixed') {
    return roundPrice(Math.max(0, item.fixedPrice ?? 0));
  }

  const discount = item.pricingMode === 'discount'
    ? item.discountPercent ?? 0
    : defaultDiscountPercent;
  return roundPrice(Math.max(0, basePrice) * (1 - clampPriceListDiscount(discount) / 100));
}

export function buildPriceListProducts(
  products: Product[],
  list: PriceList,
  items: PriceListItem[],
): Product[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((item) => {
      const product = productsById.get(item.productId);
      if (!product) return [];
      return [{
        ...product,
        salePrice: resolvePriceListPrice(product.salePrice, list.defaultDiscountPercent, item),
      }];
    });
}

export function buildAvailabilityMap(items: PriceListItem[]): Record<string, PriceListAvailability> {
  return Object.fromEntries(items.map((item) => [item.productId, item.availability]));
}

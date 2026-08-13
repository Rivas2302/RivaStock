import { describe, expect, it } from 'vitest';
import type { PriceList, PriceListItem, Product } from '../types';
import { buildAvailabilityMap, buildPriceListProducts, resolvePriceListPrice } from './priceListPricing';

const item = (overrides: Partial<PriceListItem> = {}): PriceListItem => ({
  id: 'item-1',
  ownerUid: 'owner-1',
  priceListId: 'list-1',
  productId: 'product-1',
  pricingMode: 'default',
  discountPercent: null,
  fixedPrice: null,
  availability: 'in_stock',
  sortOrder: 0,
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
  ...overrides,
});

describe('reseller price calculations', () => {
  it('applies the global discount by default', () => {
    expect(resolvePriceListPrice(10_000, 20, item())).toBe(8_000);
  });

  it('supports a product-specific discount', () => {
    expect(resolvePriceListPrice(10_000, 20, item({ pricingMode: 'discount', discountPercent: 12.5 }))).toBe(8_750);
  });

  it('supports a fixed product price and never returns negative values', () => {
    expect(resolvePriceListPrice(10_000, 20, item({ pricingMode: 'fixed', fixedPrice: 7_490 }))).toBe(7_490);
    expect(resolvePriceListPrice(10_000, 20, item({ pricingMode: 'fixed', fixedPrice: -1 }))).toBe(0);
  });

  it('builds only included products with their reseller price and availability', () => {
    const product = {
      id: 'product-1',
      name: 'Producto',
      salePrice: 10_000,
    } as Product;
    const list = { id: 'list-1', defaultDiscountPercent: 20 } as PriceList;
    const items = [item({ availability: 'on_order' })];

    expect(buildPriceListProducts([product], list, items)).toEqual([{ ...product, salePrice: 8_000 }]);
    expect(buildAvailabilityMap(items)).toEqual({ 'product-1': 'on_order' });
  });
});

import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import {
  countMobileStockStatuses,
  filterMobileStockProducts,
  matchesMobileStockQuery,
  normalizeMobileStockSearch,
  type MobileStockFilterOptions,
} from './mobileStockFilters';

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: 'Producto ' + id,
    categoryId: 'category',
    category: 'General',
    purchasePrice: 1,
    salePrice: 10,
    stock: 5,
    minStock: 2,
    showInCatalog: true,
    ownerUid: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const options = (overrides: Partial<MobileStockFilterOptions> = {}): MobileStockFilterOptions => ({
  query: '',
  category: 'all',
  status: 'all',
  sort: 'name',
  catalogOnly: false,
  ownerFilter: 'all',
  holdingsEnabled: false,
  stockByProduct: new Map(),
  ownerIdsByProduct: new Map(),
  ownerTermsByProduct: new Map(),
  restockProductIds: new Set(),
  ...overrides,
});

describe('mobile stock filtering', () => {
  it('normalizes accents, capitalization, whitespace, and search word order', () => {
    expect(normalizeMobileStockSearch('  CÁMARA   WiFi ')).toBe('camara wifi');
    expect(matchesMobileStockQuery(product('camera', { name: 'Cámara WiFi 360' }), 'wifi camara')).toBe(true);
  });

  it('searches the barcode and visible holder names', () => {
    const item = product('camera', { name: 'Cámara 360', barcode: '7790070123456' });
    expect(matchesMobileStockQuery(item, '7790070123456')).toBe(true);
    expect(matchesMobileStockQuery(item, 'camara riva', ['Riva'])).toBe(true);
  });

  it('filters by inventory holder when shared holdings are enabled', () => {
    const items = [product('shared-a'), product('shared-b')];
    const ownerIdsByProduct = new Map([
      ['shared-a', new Set(['owner-a', 'owner-b'])],
      ['shared-b', new Set(['owner-b'])],
    ]);
    expect(filterMobileStockProducts(items, options({
      holdingsEnabled: true,
      ownerFilter: 'owner-a',
      ownerIdsByProduct,
    })).map((item) => item.id)).toEqual(['shared-a']);
  });

  it('combines category, catalog, status, and replenishment filters before sorting', () => {
    const items = [
      product('b', { name: 'Cargador B', category: 'Cargadores', salePrice: 100, stock: 0 }),
      product('a', { name: 'Cargador A', category: 'Cargadores', salePrice: 200, stock: 1, minStock: 2 }),
      product('c', { name: 'Funda C', category: 'Fundas', salePrice: 300, showInCatalog: false }),
    ];
    const stockByProduct = new Map([['a', 1], ['b', 0], ['c', 4]]);
    expect(filterMobileStockProducts(items, options({
      category: 'Cargadores',
      status: 'bajo',
      sort: 'price_desc',
      stockByProduct,
    })).map((item) => item.id)).toEqual(['a']);
    expect(filterMobileStockProducts(items, options({
      status: 'reponer',
      restockProductIds: new Set(['b']),
      stockByProduct,
    })).map((item) => item.id)).toEqual(['b']);
  });

  it('sorts stock and recency deterministically', () => {
    const items = [
      product('old', { name: 'Old', stock: 7, updatedAt: '2026-01-01T00:00:00.000Z' }),
      product('new', { name: 'New', stock: 1, updatedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(filterMobileStockProducts(items, options({ sort: 'stock_asc' })).map((item) => item.id)).toEqual(['new', 'old']);
    expect(filterMobileStockProducts(items, options({ sort: 'recent' })).map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('counts out and low stock from the supplied visible inventory', () => {
    const items = [product('out', { stock: 0 }), product('low', { stock: 2, minStock: 2 }), product('ok', { stock: 5 })];
    expect(countMobileStockStatuses(items, new Map())).toEqual({ out: 1, low: 1 });
    expect(countMobileStockStatuses(items.slice(1), new Map())).toEqual({ out: 0, low: 1 });
  });
});

import type { Product } from '../types';
import { getStockStatus } from './stockStatus';

export type MobileStockStatusFilter = 'all' | 'disponible' | 'no-disponible' | 'bajo' | 'reponer';
export type MobileStockSort = 'name' | 'stock_asc' | 'price_desc' | 'price_asc' | 'recent';

export interface MobileStockFilterOptions {
  query: string;
  category: string;
  status: MobileStockStatusFilter;
  sort: MobileStockSort;
  catalogOnly: boolean;
  ownerFilter: string;
  holdingsEnabled: boolean;
  stockByProduct: ReadonlyMap<string, number>;
  ownerIdsByProduct: ReadonlyMap<string, ReadonlySet<string>>;
  ownerTermsByProduct: ReadonlyMap<string, string[]>;
  restockProductIds: ReadonlySet<string>;
}

export function normalizeMobileStockSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchesMobileStockQuery(product: Product, query: string, ownerTerms: string[] = []): boolean {
  const words = normalizeMobileStockSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const fields = [product.name, product.barcode ?? '', ...ownerTerms].map(normalizeMobileStockSearch);
  return words.every((word) => fields.some((field) => field.includes(word)));
}

export function filterMobileStockProducts(
  products: Product[],
  options: MobileStockFilterOptions,
): Product[] {
  const filtered = products.filter((product) => {
    const stock = options.stockByProduct.get(product.id) ?? product.stock;
    if (!matchesMobileStockQuery(product, options.query, options.ownerTermsByProduct.get(product.id))) return false;
    if (options.category !== 'all' && product.category !== options.category) return false;
    if (options.ownerFilter !== 'all') {
      const matchesOwner = options.holdingsEnabled
        ? options.ownerIdsByProduct.get(product.id)?.has(options.ownerFilter) === true
        : product.inventoryOwnerId === options.ownerFilter;
      if (!matchesOwner) return false;
    }
    if (options.catalogOnly && !product.showInCatalog) return false;
    if (options.status === 'disponible' && stock <= 0) return false;
    if (options.status === 'no-disponible' && stock !== 0) return false;
    if (options.status === 'bajo' && getStockStatus(stock, product.minStock) !== 'low') return false;
    if (options.status === 'reponer' && !options.restockProductIds.has(product.id)) return false;
    return true;
  });

  const withIndex = filtered.map((product, index) => ({ product, index }));
  withIndex.sort((left, right) => {
    const a = left.product;
    const b = right.product;
    const aStock = options.stockByProduct.get(a.id) ?? a.stock;
    const bStock = options.stockByProduct.get(b.id) ?? b.stock;
    let order = 0;
    switch (options.sort) {
      case 'stock_asc': order = aStock - bStock; break;
      case 'price_desc': order = b.salePrice - a.salePrice; break;
      case 'price_asc': order = a.salePrice - b.salePrice; break;
      case 'recent': order = Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt); break;
      default: order = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    }
    return order || left.index - right.index;
  });
  return withIndex.map(({ product }) => product);
}

export function countMobileStockStatuses(
  products: Product[],
  stockByProduct: ReadonlyMap<string, number>,
): { out: number; low: number } {
  return products.reduce((counts, product) => {
    const stock = stockByProduct.get(product.id) ?? product.stock;
    const status = getStockStatus(stock, product.minStock);
    if (status === 'out') counts.out += 1;
    if (status === 'low') counts.low += 1;
    return counts;
  }, { out: 0, low: 0 });
}

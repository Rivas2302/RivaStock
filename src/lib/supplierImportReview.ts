import type { Product } from '../types';
import type { SupplierListDraftRow } from './supplierListImport';
import { calculateSupplierSuggestedPrice, type SupplierPriceRounding } from './resellerSupplierRounds';

export type SupplierImportAction = 'new' | 'updated' | 'unchanged' | 'review';

export interface SupplierImportReviewEntry {
  row: SupplierListDraftRow;
  action: SupplierImportAction;
  existingProduct: Product | null;
  supplierCostLocal: number | null;
  suggestedSalePrice: number | null;
}

export function normalizeSupplierProductName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
    .replace(/[^a-z\d]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeSourceCode(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\d]/gu, '');
}

export function planSupplierImport(input: {
  rows: SupplierListDraftRow[];
  supplierProducts: Product[];
  currency: string | null;
  usdRate: number;
  discountPercent: number;
  rounding: SupplierPriceRounding;
  marginForRow: (row: SupplierListDraftRow) => number;
}): SupplierImportReviewEntry[] {
  const currency = input.currency?.toUpperCase() ?? null;
  const existingByCode = new Map<string, Product>();
  const existingByName = new Map<string, Product>();
  for (const product of input.supplierProducts) {
    const code = normalizeSourceCode(product.barcode);
    if (code && !existingByCode.has(code)) existingByCode.set(code, product);
    const name = normalizeSupplierProductName(product.name);
    if (name && !existingByName.has(name)) existingByName.set(name, product);
  }
  return input.rows.map(row => {
    const convertedCost = row.supplierCost === null ? null
      : currency === 'USD' ? (Number.isFinite(input.usdRate) && input.usdRate > 0 ? row.supplierCost * input.usdRate : null)
        : currency === null || currency === 'ARS' ? row.supplierCost : null;
    const cost = convertedCost !== null && Number.isFinite(convertedCost) ? Math.round(convertedCost * 100) / 100 : null;
    const suggested = cost !== null && cost > 0
      ? calculateSupplierSuggestedPrice(cost, input.marginForRow(row), input.rounding) / Math.max(0.01, 1 - Math.min(99, input.discountPercent) / 100)
      : null;
    const existingProduct = (row.sourceCode ? existingByCode.get(normalizeSourceCode(row.sourceCode)) : undefined)
      ?? existingByName.get(normalizeSupplierProductName(row.name)) ?? null;
    if (row.error || cost === null || cost <= 0 || suggested === null) {
      return { row, action: 'review', existingProduct, supplierCostLocal: cost, suggestedSalePrice: suggested };
    }
    if (!existingProduct) return { row, action: 'new', existingProduct: null, supplierCostLocal: cost, suggestedSalePrice: suggested };
    const unchanged = existingProduct.name === row.name
      && Number(existingProduct.catalogCost ?? 0) === cost
      && existingProduct.salePrice === suggested
      && existingProduct.category === row.category
      && (!row.imageUrl || existingProduct.imageUrl === row.imageUrl);
    return { row, action: unchanged ? 'unchanged' : 'updated', existingProduct, supplierCostLocal: cost, suggestedSalePrice: suggested };
  });
}

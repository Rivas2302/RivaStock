import type { Category, Product } from '../types';
import type { SupplierListDraftRow } from './supplierListImport';
import { calculateSupplierSuggestedPrice, type SupplierPriceRounding } from './resellerSupplierRounds';
import { isSupplierManagedPhotoUrl } from './supplierCatalogPhoto';
import { isSupplierPhotoReviewBlocking, normalizeSupplierImportRow } from './supplierPrivacy';
import {
  calculateResellerMarginSuggestion,
  calculateResellerMarginSuggestionForRule,
  normalizeResellerMarginRules,
  type ResellerMarginRules,
  type ResellerMarginValueRule,
} from './resellerMarginRules';

export type SupplierImportAction = 'new' | 'updated' | 'unchanged' | 'review' | 'no_price';

export interface SupplierImportReviewEntry {
  row: SupplierListDraftRow;
  action: SupplierImportAction;
  existingProduct: Product | null;
  supplierCostLocal: number | null;
  suggestedResellerPrice: number | null;
  suggestedProfit: number | null;
  suggestedSalePrice: number | null;
}

export function calculateSupplierSuggestedPublicPrice(resellerPrice: number | null, generalDiscountPercent: number): number | null {
  if (resellerPrice === null || !Number.isFinite(resellerPrice) || resellerPrice < 0) return null;
  const discount = Number.isFinite(generalDiscountPercent) ? Math.min(99, Math.max(0, generalDiscountPercent)) : 0;
  return resellerPrice / (1 - discount / 100);
}

export function normalizeSupplierProductName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
    .replace(/[^a-z\d]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeSourceCode(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\d]/gu, '');
}

function normalizeSourceCategory(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR').replace(/\s+/g, ' ').trim();
}

export function resolveSupplierImportCategory(
  sourceCategory: string,
  targetCategoryId: string | undefined,
  categories: Category[],
): { categoryId: string; category: string } {
  const target = categories.find(category => category.id === targetCategoryId);
  const sourceKey = normalizeSourceCategory(sourceCategory);
  const exactSourceMatch = sourceKey
    ? categories.find(category => normalizeSourceCategory(category.name) === sourceKey)
    : undefined;
  const resolved = target ?? exactSourceMatch;
  return { categoryId: resolved?.id ?? '', category: resolved?.name ?? 'Sin categoría' };
}

export function planSupplierImport(input: {
  rows: SupplierListDraftRow[];
  supplierProducts: Product[];
  currency: string | null;
  usdRate: number;
  discountPercent: number;
  rounding: SupplierPriceRounding;
  marginForRow?: (row: SupplierListDraftRow) => number;
  categoryForRow?: (row: SupplierListDraftRow) => string | null | undefined;
  marginRules?: ResellerMarginRules;
  marginRuleForRow?: (row: SupplierListDraftRow, existingProduct: Product | null) => ResellerMarginValueRule | null;
  hasReplacementForRow?: (row: SupplierListDraftRow) => boolean;
  preserveZeroMarginPrice?: boolean;
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
  return input.rows.map(sourceRow => {
    const row = normalizeSupplierImportRow(sourceRow);
    const existingProduct = (row.sourceCode ? existingByCode.get(normalizeSourceCode(row.sourceCode)) : undefined)
      ?? existingByName.get(normalizeSupplierProductName(row.name)) ?? null;
    if (row.supplierCost === null || !Number.isFinite(row.supplierCost) || row.supplierCost <= 0) {
      return { row, action: 'no_price', existingProduct, supplierCostLocal: null, suggestedResellerPrice: null, suggestedProfit: null, suggestedSalePrice: null };
    }
    const photoBlocked = isSupplierPhotoReviewBlocking(row.photoBrandReview, input.hasReplacementForRow?.(row) ?? false);
    const convertedCost = row.supplierCost === null ? null
      : currency === 'USD' ? (Number.isFinite(input.usdRate) && input.usdRate > 0 ? row.supplierCost * input.usdRate : null)
        : currency === null || currency === 'ARS' ? row.supplierCost : null;
    const cost = convertedCost !== null && Number.isFinite(convertedCost) ? Math.round(convertedCost * 100) / 100 : null;
    const explicitRule = input.marginRuleForRow?.(row, existingProduct)
      ?? (Number.isFinite(row.marginValue) ? { mode: row.marginMode ?? 'percent', value: Number(row.marginValue), minimumProfit: null, maximumProfit: null }
        : Number.isFinite(row.marginPercent) ? { mode: 'percent' as const, value: Number(row.marginPercent), minimumProfit: null, maximumProfit: null }
          : null);
    const rules = input.marginRules ? normalizeResellerMarginRules(input.marginRules) : null;
    const exactCatalogPrice = input.preserveZeroMarginPrice === true
      && explicitRule?.mode === 'percent'
      && explicitRule.value === 0;
    const rounding = exactCatalogPrice ? 'none' : input.rounding;
    const marginSuggestion = cost !== null && cost > 0
      ? rules
        ? explicitRule
          ? calculateResellerMarginSuggestionForRule(explicitRule, cost, exactCatalogPrice ? 'none' : rules.rounding)
          : calculateResellerMarginSuggestion(rules, {
            cost,
            productId: existingProduct?.id,
            category: input.categoryForRow?.(row) ?? row.category,
          })
        : { suggestedResellerPrice: calculateSupplierSuggestedPrice(cost, explicitRule?.mode === 'fixed' ? explicitRule.value * 100 / cost : explicitRule?.value ?? input.marginForRow?.(row) ?? 25, rounding) }
      : null;
    const suggestedResellerPrice = marginSuggestion?.suggestedResellerPrice ?? null;
    const suggestedProfit = marginSuggestion
      ? Math.round((suggestedResellerPrice! - cost!) * 100) / 100
      : null;
    const suggested = calculateSupplierSuggestedPublicPrice(suggestedResellerPrice, input.discountPercent);
    if (row.error || cost === null || cost <= 0 || suggested === null || photoBlocked) {
      return { row, action: 'review', existingProduct, supplierCostLocal: cost, suggestedResellerPrice, suggestedProfit, suggestedSalePrice: suggested };
    }
    if (!existingProduct) return { row, action: 'new', existingProduct: null, supplierCostLocal: cost, suggestedResellerPrice, suggestedProfit, suggestedSalePrice: suggested };
    const existingSourceCategory = existingProduct.customFields?.supplierImportSourceCategory;
    const categoryMatches = existingSourceCategory != null
      ? normalizeSourceCategory(String(existingSourceCategory)) === normalizeSourceCategory(row.category)
      : existingProduct.category === row.category;
    const unchanged = existingProduct.name === row.name
      && Number(existingProduct.catalogCost ?? 0) === cost
      && existingProduct.salePrice === suggested
      && categoryMatches
      && existingProduct.customFields?.supplierImportPriceStatus !== 'Sin precio'
      && (!row.imageUrl || existingProduct.imageUrl === row.imageUrl || isSupplierManagedPhotoUrl(existingProduct.imageUrl));
    return { row, action: unchanged ? 'unchanged' : 'updated', existingProduct, supplierCostLocal: cost, suggestedResellerPrice, suggestedProfit, suggestedSalePrice: suggested };
  });
}

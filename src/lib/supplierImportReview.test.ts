import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { planSupplierImport } from './supplierImportReview';
import { DEFAULT_RESELLER_MARGIN_RULES } from './resellerMarginRules';

const product = (changes: Partial<Product> = {}): Product => ({
  id: 'product-1', name: 'Cable iPhone C', categoryId: 'category-1', category: 'Cables',
  purchasePrice: 0, salePrice: 16000, stock: 0, minStock: 0, showInCatalog: false,
  catalogOnly: true, catalogCost: 12345.67, barcode: 'SKU-1', ownerUid: 'owner-1',
  createdAt: '', updatedAt: '', ...changes,
});

const row = (changes = {}) => ({
  sourceRow: 1, sourceCode: 'SKU-1', sourceCurrency: 'USD', name: 'Cable iPhone C',
  supplierCost: 12.34567, category: 'Cables', imageUrl: null, error: null, ...changes,
});

describe('supplier import review', () => {
  it('converts USD with the entered rate and matches existing products by supplier code', () => {
    const plan = planSupplierImport({
      rows: [row()], supplierProducts: [product()], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none', marginForRow: () => 25,
    });
    expect(plan[0]).toMatchObject({ action: 'updated', existingProduct: { id: 'product-1' }, supplierCostLocal: 12345.67 });
  });

  it('requires a rate for USD and does not silently convert another foreign currency', () => {
    const args = { rows: [row()], supplierProducts: [], usdRate: 0, discountPercent: 20, rounding: 'none' as const, marginForRow: () => 25 };
    expect(planSupplierImport({ ...args, currency: 'USD' })[0].action).toBe('review');
    expect(planSupplierImport({ ...args, currency: 'EUR' })[0].action).toBe('review');
  });

  it('matches normalized names only within the supplied supplier product set', () => {
    const candidate = product({ id: 'linked', name: 'Cable iPhone C', barcode: undefined, catalogCost: 12345.67 });
    const item = row({ sourceCode: 'other-code' });
    expect(planSupplierImport({
      rows: [item], supplierProducts: [candidate], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none', marginForRow: () => 25,
    })[0]).toMatchObject({ action: 'updated', existingProduct: { id: 'linked' } });
    expect(planSupplierImport({
      rows: [item], supplierProducts: [], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none', marginForRow: () => 25,
    })[0].action).toBe('new');
  });

  it('uses the saved cost tier and category exception for supplier import prices', () => {
    const plan = planSupplierImport({
      rows: [row()], supplierProducts: [], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none', marginRules: {
        ...DEFAULT_RESELLER_MARGIN_RULES,
        categoryOverrides: { cables: { mode: 'fixed', value: 5_000, minimumProfit: null, maximumProfit: null } },
      },
    });
    expect(plan[0].supplierCostLocal).toBe(12345.67);
    expect(plan[0].suggestedResellerPrice).toBe(17345.67);
    expect(plan[0].suggestedProfit).toBe(5_000);
    expect(plan[0].suggestedSalePrice).toBeCloseTo(21682.0875, 8);
  });

  it('lets a specific existing product rule take priority during supplier import', () => {
    const plan = planSupplierImport({
      rows: [row()], supplierProducts: [product()], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none', marginRules: {
        ...DEFAULT_RESELLER_MARGIN_RULES,
        categoryOverrides: { cables: { mode: 'fixed', value: 5_000, minimumProfit: null, maximumProfit: null } },
        productOverrides: { 'product-1': { mode: 'percent', value: 50, minimumProfit: null, maximumProfit: null } },
      },
    });
    expect(plan[0].suggestedResellerPrice).toBe(18518.51);
  });

  it('keeps photos with provider branding out of the ready rows until explicitly resolved', () => {
    const input = {
      rows: [row({ photoBrandReview: { source: { status: 'flagged' as const, matches: ['www'] } } })],
      supplierProducts: [], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none' as const, marginForRow: () => 25,
    };
    expect(planSupplierImport(input)[0].action).toBe('review');
    expect(planSupplierImport({
      ...input,
      rows: [row({ photoBrandReview: { source: { status: 'flagged', matches: ['www'], approved: true } } })],
    })[0].action).toBe('new');
    expect(planSupplierImport({
      ...input,
      hasReplacementForRow: () => true,
      rows: [row({ photoBrandReview: {
        source: { status: 'flagged', matches: ['www'] },
        replacement: { status: 'clear', matches: [] },
      } })],
    })[0].action).toBe('new');
  });
});

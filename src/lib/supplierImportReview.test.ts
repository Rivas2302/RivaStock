import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { calculateSupplierSuggestedPublicPrice, planSupplierImport } from './supplierImportReview';
import { DEFAULT_RESELLER_MARGIN_RULES } from './resellerMarginRules';
import { parseSupplierListRows } from './supplierListImport';
import {
  clearSupplierProductNoPriceStatus,
  getSupplierImportMatchingProducts,
  getSupplierProductIdsAfterImport,
  markSupplierProductWithoutPrice,
  SUPPLIER_IMPORT_PRICE_STATUS_FIELD,
} from './supplierImportProductStatus';

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
  it('calculates the suggested public price from the reseller price and the general discount', () => {
    expect(calculateSupplierSuggestedPublicPrice(2660, 20)).toBe(3325);
    expect(calculateSupplierSuggestedPublicPrice(2660, 0)).toBe(2660);
    expect(calculateSupplierSuggestedPublicPrice(null, 20)).toBeNull();
  });

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

  it('does not treat a saved owner category as a supplier category change on reimport', () => {
    const sourceRow = row({ category: 'Accesorios', supplierCost: 100, sourceCurrency: 'ARS' });
    const mappedProduct = product({
      category: 'General',
      catalogCost: 100,
      salePrice: 100,
      customFields: { supplierImportSourceCategory: 'Accesorios' },
    });
    const [entry] = planSupplierImport({
      rows: [sourceRow], supplierProducts: [mappedProduct], currency: 'ARS', usdRate: 0,
      discountPercent: 0, rounding: 'none', marginForRow: () => 0,
    });

    expect(entry.action).toBe('unchanged');
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

  it('uses the selected owner category when applying category margin rules during import', () => {
    const plan = planSupplierImport({
      rows: [row({ category: 'Electrónica del proveedor' })], supplierProducts: [], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none', marginRules: {
        ...DEFAULT_RESELLER_MARGIN_RULES,
        categoryOverrides: { accesorios: { mode: 'fixed', value: 5_000, minimumProfit: null, maximumProfit: null } },
      },
      categoryForRow: () => 'Accesorios',
    });

    expect(plan[0].suggestedProfit).toBe(5_000);
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

  it('keeps a zero-margin RivaStock catalog price exact despite saved price rounding', () => {
    const plan = planSupplierImport({
      rows: [row({ supplierCost: 2660, sourceCurrency: 'ARS', marginMode: 'percent', marginValue: 0 })],
      supplierProducts: [], currency: 'ARS', usdRate: 0, discountPercent: 0, rounding: 500,
      marginRules: { ...DEFAULT_RESELLER_MARGIN_RULES, rounding: 500 }, preserveZeroMarginPrice: true,
    });
    expect(plan[0]).toMatchObject({ suggestedResellerPrice: 2660, suggestedSalePrice: 2660, suggestedProfit: 0 });
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

  it('keeps pending, failed, and cancelled photo reviews addable', () => {
    for (const status of ['pending', 'failed', 'unreviewed'] as const) {
      const plan = planSupplierImport({
        rows: [row({ photoBrandReview: { source: { status, matches: [] } } })],
        supplierProducts: [], currency: 'USD', usdRate: 1000,
        discountPercent: 20, rounding: 'none', marginForRow: () => 25,
      });
      expect(plan[0].action).toBe('new');
    }
  });

  it('drops unpriced Mr Tecno sample rows and unlists an existing product without deleting it', () => {
    const mrTecnoSample = parseSupplierListRows([
      ['Código', 'Producto', 'Costo', 'Categoría'],
      ['C91015', 'Cable iPhone C', 'Consultar', 'Cargadores'],
      ['YH88214N', 'Cargador USB', '$ 0', 'Cargadores'],
      ['1015', 'Lámpara solar', '$ 7.75', 'Iluminación'],
    ]);
    const previouslyImported = product({ id: 'mrtecno-cable', barcode: 'C91015', salePrice: 16000, catalogCost: 12345.67 });
    const review = planSupplierImport({
      rows: mrTecnoSample,
      supplierProducts: [previouslyImported],
      currency: 'USD', usdRate: 1000, discountPercent: 20, rounding: 'none',
    });

    expect(review.map(entry => entry.action)).toEqual(['no_price', 'no_price', 'new']);
    expect(review[0].existingProduct?.id).toBe('mrtecno-cable');
    expect(review[1].existingProduct).toBeNull();
    expect(review.filter(entry => entry.action === 'no_price')).toHaveLength(2);

    const marked = markSupplierProductWithoutPrice(previouslyImported, 'mrtecno-supplier');
    expect(marked).toMatchObject({ id: 'mrtecno-cable', salePrice: 16000, catalogCost: 12345.67,
      customFields: { supplierImportSupplierId: 'mrtecno-supplier', supplierImportPriceStatus: 'Sin precio' } });
    expect(getSupplierProductIdsAfterImport(
      ['mrtecno-cable', 'manual-product'], review, new Map([[4, 'new-priced-product']]),
    )).toEqual(['manual-product', 'new-priced-product']);
    expect(getSupplierImportMatchingProducts([marked], [], 'mrtecno-supplier')).toEqual([marked]);

    const restored = planSupplierImport({
      rows: [row({ sourceCode: 'C91015', supplierCost: 10, sourceCurrency: 'USD' })],
      supplierProducts: [marked], currency: 'USD', usdRate: 1000,
      discountPercent: 20, rounding: 'none',
    })[0];
    expect(restored).toMatchObject({ action: 'updated', existingProduct: { id: 'mrtecno-cable' } });
    const restoredFields = clearSupplierProductNoPriceStatus(marked.customFields, 'mrtecno-supplier');
    expect(restoredFields?.supplierImportSupplierId).toBe('mrtecno-supplier');
    expect(restoredFields).not.toHaveProperty(SUPPLIER_IMPORT_PRICE_STATUS_FIELD);
  });
});

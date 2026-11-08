import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('own inventory product visibility wiring', () => {
  it('filters operational product selectors and photo-sharing lists', () => {
    for (const path of [
      'src/pages/Sales.tsx',
      'src/pages/POS.tsx',
      'src/pages/Quotes.tsx',
      'src/pages/Calculator.tsx',
      'src/pages/Intake.tsx',
      'src/pages/ProductPhotos.tsx',
      'src/pages/QuickPrice.tsx',
      'src/pages/Settings.tsx',
      'src/pages/AIHub.tsx',
      'src/components/ai/MobileAITaskNewTask.tsx',
      'src/components/automations/PublicationProductPicker.tsx',
    ]) {
      expect(source(path), path).toContain('filterOwnInventoryProducts');
    }
  });

  it('filters Stock while preserving supplier catalog access in Revendedores', () => {
    expect(source('src/pages/Stock.tsx')).toContain(
      'isResellersRoute ? nextProducts : filterOwnInventoryProducts(nextProducts)',
    );
  });

  it('keeps dashboard stock valuation and restock suggestions on own inventory only', () => {
    expect(source('src/lib/dashboardSummary.ts')).toContain('filterOwnInventoryProducts(products)');
    expect(source('src/lib/stockValuation.ts')).toContain('products.filter(isOwnInventoryProduct)');
    expect(source('src/pages/Dashboard.tsx')).toContain(
      'getRestockRecommendations(getDashboardInventoryProducts(products), sales)',
    );
  });

  it('keeps supplier products available to the reseller workflow', () => {
    expect(source('src/components/ResellerPriceListModal.tsx')).toContain('catalogOnly: true');
  });
});

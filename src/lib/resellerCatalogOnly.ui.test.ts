import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(
  resolve(process.cwd(), 'src/components/ResellerPriceListModal.tsx'),
  'utf8',
);
const stock = readFileSync(resolve(process.cwd(), 'src/pages/Stock.tsx'), 'utf8');

describe('catalog-only reseller products UI', () => {
  it('creates a product with the supplier-list context', () => {
    expect(modal).toContain('Crear para esta lista');
    expect(modal).toContain('supplierId: supplier.id');
    expect(modal).toContain('productIds: supplierDraftProductIds');
    expect(stock).toContain('saveResellerSupplierList');
  });

  it('collects the full public product record without creating inventory', () => {
    expect(stock).toContain('Costo del proveedor');
    expect(stock).toContain('Descripción pública');
    expect(stock).toContain('catalogOnly: true');
    expect(stock).toContain('stock: 0');
    expect(stock).toContain('showInCatalog: false');
  });

  it('keeps catalog-only products out of Stock and its ordinary PDF', () => {
    expect(stock).toContain('products.filter((product) => !product.catalogOnly)');
    expect(stock).toContain('!product.catalogOnly');
  });

  it('supports editing and explicit promotion with real stock', () => {
    expect(modal).toContain('Solo catálogo · no está en stock');
    expect(modal).toContain('Editar ficha');
    expect(modal).toContain('Agregar al stock');
    expect(stock).toContain('promotionStock <= 0');
    expect(stock).toContain('promoteResellerCatalogProduct');
  });
});

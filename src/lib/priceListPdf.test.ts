import { describe, expect, it, vi } from 'vitest';
import type { Category, Product } from '../types';

vi.mock('./inventoryOwners', () => ({
  getInventoryOwnerName: () => null,
}));

import { createPriceListPdf } from './priceListPdf';

const product: Product = {
  id: 'product-1',
  name: 'Producto de prueba',
  categoryId: 'category-1',
  category: 'Prueba',
  purchasePrice: 10_000,
  salePrice: 15_000,
  stock: 1,
  minStock: 0,
  showInCatalog: true,
  ownerUid: 'owner-1',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

const category: Category = {
  id: 'category-1',
  name: 'Prueba',
  ownerUid: 'owner-1',
};

describe('price list PDF', () => {
  it('generates a non-empty PDF blob for the reseller preview', () => {
    const pdf = createPriceListPdf({
      products: [product],
      categories: [category],
      businessName: 'RivaStock',
      title: 'Lista de precios para revendedores',
      fileNamePrefix: 'lista-revendedores',
      availabilityByProductId: { [product.id]: 'in_stock' },
      commercialNotice: 'Compra mínima: $ 50.000',
    });

    expect(pdf.blob.type).toBe('application/pdf');
    expect(pdf.blob.size).toBeGreaterThan(1_000);
    expect(pdf.fileName).toMatch(/^lista-revendedores-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

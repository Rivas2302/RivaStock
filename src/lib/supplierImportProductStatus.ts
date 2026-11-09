import type { Product } from '../types';
import type { SupplierImportReviewEntry } from './supplierImportReview';

export const SUPPLIER_IMPORT_ID_FIELD = 'supplierImportSupplierId';
export const SUPPLIER_IMPORT_PRICE_STATUS_FIELD = 'supplierImportPriceStatus';
export const SUPPLIER_IMPORT_NO_PRICE_STATUS = 'Sin precio';

export function getSupplierImportMatchingProducts(
  products: Product[],
  selectedProductIds: string[],
  supplierId: string,
): Product[] {
  const selected = new Set(selectedProductIds);
  return products.filter(product => selected.has(product.id)
    || product.customFields?.[SUPPLIER_IMPORT_ID_FIELD] === supplierId);
}

export function markSupplierProductWithoutPrice(product: Product, supplierId: string): Product {
  return {
    ...product,
    customFields: {
      ...(product.customFields ?? {}),
      [SUPPLIER_IMPORT_ID_FIELD]: supplierId,
      [SUPPLIER_IMPORT_PRICE_STATUS_FIELD]: SUPPLIER_IMPORT_NO_PRICE_STATUS,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function clearSupplierProductNoPriceStatus(
  customFields: Product['customFields'],
  supplierId: string,
): Product['customFields'] {
  const next = { ...(customFields ?? {}), [SUPPLIER_IMPORT_ID_FIELD]: supplierId };
  delete next[SUPPLIER_IMPORT_PRICE_STATUS_FIELD];
  return next;
}

export function getSupplierProductIdsAfterImport(
  currentProductIds: string[],
  entries: SupplierImportReviewEntry[],
  resolvedProductIds: Map<number, string>,
): string[] {
  const noPriceIds = new Set(entries.flatMap(entry => (
    entry.action === 'no_price' && entry.existingProduct ? [entry.existingProduct.id] : []
  )));
  const importedIds = entries.flatMap(entry => {
    if (!['new', 'updated', 'unchanged'].includes(entry.action)) return [];
    const id = resolvedProductIds.get(entry.row.sourceRow);
    return id ? [id] : [];
  });
  return Array.from(new Set([...currentProductIds, ...importedIds])).filter(id => !noPriceIds.has(id));
}

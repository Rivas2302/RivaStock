import type { InventoryHoldingDraft, Product } from '../types';

export type ProductEditorValidationErrors = Partial<Record<
  'name' | 'category' | 'salePrice' | 'stock' | 'purchasePrice' | 'minStock' | 'catalogCost',
  string
>>;

interface ValidateProductEditorOptions {
  formData: Partial<Product>;
  holdingDrafts: InventoryHoldingDraft[];
  holdingsEnabled: boolean;
  creatingProductForReseller: boolean;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export function validateProductEditorForm({
  formData,
  holdingDrafts,
  holdingsEnabled,
  creatingProductForReseller,
}: ValidateProductEditorOptions): ProductEditorValidationErrors {
  const errors: ProductEditorValidationErrors = {};
  const salePrice = asNumber(formData.salePrice ?? 0);

  if (!formData.name?.trim()) errors.name = 'Ingresá el nombre del producto.';
  if (!formData.categoryId) errors.category = 'Elegí una categoría.';
  if (!Number.isFinite(salePrice) || salePrice <= 0) errors.salePrice = 'El precio de venta debe ser mayor que cero.';

  if (holdingsEnabled && !creatingProductForReseller) {
    if (holdingDrafts.some((draft) => !Number.isInteger(draft.stock) || draft.stock < 0)) {
      errors.stock = 'El stock de cada titular debe ser un número entero igual o mayor que cero.';
    }
    if (holdingDrafts.some((draft) => !Number.isFinite(draft.purchaseCost) || draft.purchaseCost < 0)) {
      errors.purchasePrice = 'El costo de compra debe ser cero o mayor.';
    }
    if (holdingDrafts.some((draft) => !Number.isInteger(draft.minStock) || draft.minStock < 0)) {
      errors.minStock = 'El mínimo debe ser un número entero igual o mayor que cero.';
    }
  } else {
    const stock = asNumber(formData.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) errors.stock = 'El stock debe ser un número entero igual o mayor que cero.';
  }

  if (!holdingsEnabled && !creatingProductForReseller) {
    const purchasePrice = asNumber(formData.purchasePrice ?? 0);
    const minStock = asNumber(formData.minStock ?? 0);
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) errors.purchasePrice = 'El costo de compra debe ser cero o mayor.';
    if (!Number.isInteger(minStock) || minStock < 0) errors.minStock = 'El mínimo debe ser un número entero igual o mayor que cero.';
  }

  if (creatingProductForReseller && asNumber(formData.catalogCost ?? 0) <= 0) {
    errors.catalogCost = 'Ingresá el costo del proveedor.';
  }

  return errors;
}

export function firstProductEditorValidationError(errors: ProductEditorValidationErrors): string | null {
  return errors.name
    ?? errors.category
    ?? errors.salePrice
    ?? errors.stock
    ?? errors.purchasePrice
    ?? errors.minStock
    ?? errors.catalogCost
    ?? null;
}

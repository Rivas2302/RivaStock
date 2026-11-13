import { describe, expect, it } from 'vitest';
import { validateProductEditorForm } from './productEditorValidation';

const validForm = {
  formData: { name: 'Producto QA', categoryId: 'cat-1', salePrice: 100, stock: 0, purchasePrice: 0, minStock: 0 },
  holdingDrafts: [],
  holdingsEnabled: false,
  creatingProductForReseller: false,
};

describe('product editor validation', () => {
  it('requires a name, a positive sale price, and a non-negative integer stock', () => {
    expect(validateProductEditorForm({
      ...validForm,
      formData: { ...validForm.formData, name: ' ', salePrice: 0, stock: 1.5 },
    })).toMatchObject({
      name: 'Ingresá el nombre del producto.',
      salePrice: 'El precio de venta debe ser mayor que cero.',
      stock: 'El stock debe ser un número entero igual o mayor que cero.',
    });
  });

  it('accepts zero stock and validates each inventory holding', () => {
    expect(validateProductEditorForm(validForm)).toEqual({});
    expect(validateProductEditorForm({
      ...validForm,
      holdingsEnabled: true,
      holdingDrafts: [{ inventoryOwnerId: 'owner-1', stock: -1, purchaseCost: 0, minStock: 0, active: true }],
    })).toMatchObject({ stock: 'El stock de cada titular debe ser un número entero igual o mayor que cero.' });
  });

  it('keeps reseller supplier-cost validation', () => {
    expect(validateProductEditorForm({
      ...validForm,
      creatingProductForReseller: true,
      formData: { ...validForm.formData, catalogCost: 0 },
    })).toMatchObject({ catalogCost: 'Ingresá el costo del proveedor.' });
  });
});

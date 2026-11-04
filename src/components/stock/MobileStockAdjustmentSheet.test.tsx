// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryHolding, InventoryOwner, Product } from '../../types';
import MobileStockAdjustmentSheet from './MobileStockAdjustmentSheet';

const PRODUCT: Product = {
  id: 'product-1', name: 'Cable USB-C', category: 'Accesorios', categoryId: 'category-1',
  purchasePrice: 10, salePrice: 20, stock: 5, minStock: 1, images: [], showInCatalog: true,
  inventoryOwnerId: 'owner-1', ownerUid: 'business-1', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
};
const OWNERS: InventoryOwner[] = [
  { id: 'owner-1', ownerUid: 'business-1', name: 'Depósito', sortOrder: 0, isPrimary: true, createdAt: '', updatedAt: '' },
  { id: 'owner-2', ownerUid: 'business-1', name: 'Local', sortOrder: 1, isPrimary: false, createdAt: '', updatedAt: '' },
];
const HOLDINGS: InventoryHolding[] = [
  { id: 'holding-1', ownerUid: 'business-1', productId: 'product-1', inventoryOwnerId: 'owner-1', stock: 5, purchaseCost: 10, minStock: 1, active: true, createdAt: '', updatedAt: '' },
  { id: 'holding-2', ownerUid: 'business-1', productId: 'product-1', inventoryOwnerId: 'owner-2', stock: 8, purchaseCost: 11, minStock: 1, active: true, createdAt: '', updatedAt: '' },
];

describe('MobileStockAdjustmentSheet', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });
  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };
  const setInput = async (input: HTMLInputElement | null, value: string) => {
    if (!input) throw new Error('No se encontró el campo esperado.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const props = (overrides: Partial<React.ComponentProps<typeof MobileStockAdjustmentSheet>> = {}) => ({
    product: PRODUCT, holdings: [], owners: OWNERS, operableInventoryOwnerIds: ['owner-1', 'owner-2'],
    holdingsEnabled: false, canWrite: true, onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(null),
    onOpenIntake: vi.fn(), ...overrides,
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('crypto', { randomUUID: () => 'attempt-1' });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the current total and previews the result before saving an addition', async () => {
    const value = props();
    await render(<MobileStockAdjustmentSheet {...value} />);
    await setInput(host.querySelector<HTMLInputElement>('input[aria-label="Cantidad"]'), '2');
    expect(host.textContent).toContain('Stock actual: 5 unidades');
    expect(host.textContent).toContain('Va a quedar en 7 unidades');
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Guardar ajuste') ?? null);
    expect(value.onSave).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'product-1', inventoryOwnerId: null, mode: 'add', quantity: 2,
      reason: 'Ingresó mercadería', idempotencyKey: 'stock-adjustment:attempt-1',
    }));
    expect(value.onClose).toHaveBeenCalledOnce();
  });

  it('blocks a restock below zero and requires a reason for Otro', async () => {
    const value = props({ product: { ...PRODUCT, stock: 1 } });
    await render(<MobileStockAdjustmentSheet {...value} />);
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Restar') ?? null);
    await setInput(host.querySelector<HTMLInputElement>('input[aria-label="Cantidad"]'), '2');
    expect(host.textContent).toContain('Va a quedar en -1 unidades');
    expect(host.textContent).toContain('El stock no puede quedar por debajo de cero.');
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Otro') ?? null);
    await setInput(host.querySelector<HTMLInputElement>('input[maxlength="300"]'), '');
    const saveButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Guardar ajuste');
    expect(saveButton?.disabled).toBe(true);
    expect(value.onSave).not.toHaveBeenCalled();
  });

  it('selects an operable holding and defaults count to that holder current stock', async () => {
    const value = props({ holdings: HOLDINGS, holdingsEnabled: true });
    await render(<MobileStockAdjustmentSheet {...value} />);
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Contar') ?? null);
    const ownerSelect = host.querySelector<HTMLSelectElement>('select[aria-label="Titular"]');
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Unidades contadas"]')?.value).toBe('5');
    if (!ownerSelect) throw new Error('No se encontró el selector de titular.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(ownerSelect, 'owner-2');
      ownerSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Unidades contadas"]')?.value).toBe('8');
    expect(host.textContent).toContain('Local · Stock actual: 8 unidades');
  });

  it('shows a localized retry message after a failed request', async () => {
    const value = props({ onSave: vi.fn().mockRejectedValue(new Error('Failed to fetch')) });
    await render(<MobileStockAdjustmentSheet {...value} />);
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Guardar ajuste') ?? null);
    expect(await host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo ajustar el stock. Revisá tu conexión e intentá de nuevo.');
    expect(value.onClose).not.toHaveBeenCalled();
  });
});

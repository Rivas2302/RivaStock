// @vitest-environment jsdom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Product } from '../../types';
import MobileProductForm from './MobileProductForm';

vi.mock('../../hooks/useMobileAppChrome', () => ({ useMobileAppChrome: vi.fn() }));
vi.mock('../ImageUpload', () => ({
  ImageUpload: () => <div data-testid="product-image-upload">Sacar foto Galería</div>,
}));

const PRODUCT: Product = {
  id: 'product-1', name: 'Cable USB-C', categoryId: 'category-1', category: 'Cargadores',
  purchasePrice: 100, salePrice: 250, stock: 5, minStock: 1, images: [], showInCatalog: true,
  inventoryOwnerId: 'owner-1', ownerUid: 'business-1', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
};
const CATEGORIES: Category[] = [{ id: 'category-1', name: 'Cargadores', ownerUid: 'business-1' }];

function StatefulForm(props: React.ComponentProps<typeof MobileProductForm>) {
  const [formData, setFormData] = useState(props.formData);
  return <MobileProductForm {...props} formData={formData} setFormData={setFormData} />;
}

describe('MobileProductForm', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async (ui: ReactElement) => act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>); });
  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };
  const changeInput = async (input: HTMLInputElement | null, value: string) => {
    if (!input) throw new Error('No se encontró el campo esperado.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const props = (overrides: Partial<React.ComponentProps<typeof MobileProductForm>> = {}) => ({
    product: null,
    formData: { ...PRODUCT, id: 'new-product', name: '', stock: 0, purchasePrice: 100, salePrice: 200 },
    setFormData: vi.fn(),
    holdingDrafts: [],
    setHoldingDrafts: vi.fn(),
    categories: CATEGORIES,
    owners: [],
    assignableOwners: [],
    priceRanges: [{ id: 'range-1', minPrice: 0, maxPrice: 200, markupPercent: 150, ownerUid: 'business-1' }],
    ownerUid: 'business-1',
    holdingsEnabled: false,
    creatingProductForReseller: false,
    supplierListName: null,
    promotingCatalogProduct: false,
    canEditInitialStock: true,
    isOwner: true,
    qaPublishAllowedSaving: false,
    qaPublishAllowedError: '',
    isUploadingImage: false,
    saving: false,
    onSave: vi.fn(),
    onClose: vi.fn(),
    onDiscard: vi.fn(),
    onAdjustStock: vi.fn(),
    onScanBarcode: vi.fn(),
    onToggleQaPublishAllowed: vi.fn(),
    onImageUploadStart: vi.fn(),
    onImageUploadEnd: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('presents the mobile field order, live margin and tappable suggested price', async () => {
    const value = props();
    await render(<MobileProductForm {...value} />);
    const text = host.textContent ?? '';
    expect(text.indexOf('Sacar foto')).toBeLessThan(text.indexOf('Nombre'));
    expect(text.indexOf('Nombre')).toBeLessThan(text.indexOf('Categoría'));
    expect(text.indexOf('Categoría')).toBeLessThan(text.indexOf('Precio de compra'));
    expect(text.indexOf('Precio de compra')).toBeLessThan(text.indexOf('Stock inicial'));
    expect(text).toContain('Margen 50 %');
    const suggested = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Usar sugerido'));
    await click(suggested ?? null);
    expect(value.setFormData).toHaveBeenCalledWith(expect.any(Function));
  });

  it('asks before discarding edits and keeps the form when the user chooses to continue', async () => {
    const value = props();
    await render(<StatefulForm {...value} />);
    await changeInput(host.querySelector<HTMLInputElement>('input[autocomplete="off"]'), 'Nuevo nombre');
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Cerrar editor"]'));
    expect(host.textContent).toContain('¿Descartar los cambios?');
    await click([...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Descartar') ?? null);
    expect(value.onDiscard).toHaveBeenCalledOnce();
  });

  it('keeps stock read-only while editing and routes stock changes through the adjustment action', async () => {
    const value = props({ product: PRODUCT, formData: PRODUCT });
    await render(<MobileProductForm {...value} />);
    const stock = host.querySelector<HTMLInputElement>('input[type="number"][inputmode="numeric"]');
    expect(stock?.readOnly).toBe(true);
    expect(host.textContent).not.toContain('¿Descartar los cambios?');
    const adjustButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Ajustar');
    expect(adjustButton).toBeDefined();
    await click(adjustButton ?? null);
    expect(host.textContent).not.toContain('¿Descartar los cambios?');
    expect(value.onAdjustStock).toHaveBeenCalledOnce();
  });
});

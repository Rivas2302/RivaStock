// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import ProductSearchSelect from './ProductSearchSelect';

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactElement }) => children,
  motion: { div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> },
}));
vi.mock('../lib/inventoryOwners', () => ({
  getInventoryOwnerName: () => '',
  getInventoryOwnerProductLabel: (product: Product) => product.name,
}));

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1',
  name: 'Cámara WiFi',
  categoryId: 'category-camera',
  category: 'Cámaras',
  purchasePrice: 100,
  salePrice: 2500,
  stock: 3,
  minStock: 1,
  images: [
    'https://rivastock-test.invalid/storage/v1/object/public/assets/camera-a.webp',
    'https://rivastock-test.invalid/storage/v1/object/public/assets/camera-b.webp',
  ],
  showInCatalog: true,
  ownerUid: 'owner-1',
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
  ...overrides,
});

describe('ProductSearchSelect', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });

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

  it('tries the thumbnail, falls back to the original once, then shows a neutral icon', async () => {
    await render(<ProductSearchSelect products={[product()]} value="" onChange={vi.fn()} />);
    const input = host.querySelector('input:not([readonly])') as HTMLInputElement;
    await act(async () => { input.focus(); });

    let image = host.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://rivastock-test.invalid/storage/v1/object/public/assets/camera-a.thumb.webp');

    await act(async () => { image?.dispatchEvent(new Event('error')); });
    image = host.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://rivastock-test.invalid/storage/v1/object/public/assets/camera-a.webp');

    await act(async () => { image?.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Sin imagen para Cámara WiFi');
  });

  it('shows a full selected-product preview and opens a multi-photo viewer', async () => {
    await render(<ProductSearchSelect products={[product()]} value="product-1" onChange={vi.fn()} />);
    const preview = host.querySelector('[data-testid="selected-product-preview"]');
    expect(preview?.textContent).toContain('Cámara WiFi');
    expect(preview?.textContent).toContain('3 disponibles');
    expect(preview?.textContent).toContain('2.500');

    const openButton = host.querySelector('button[aria-label="Ver fotos de Cámara WiFi"]') as HTMLButtonElement;
    await act(async () => { openButton.click(); });
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Fotos de Cámara WiFi');
    expect(host.querySelector('[role="dialog"] img')?.getAttribute('src')).toContain('camera-a.webp');

    const nextButton = host.querySelector('button[aria-label="Foto siguiente"]') as HTMLButtonElement;
    await act(async () => { nextButton.click(); });
    expect(host.querySelector('[role="dialog"] img')?.getAttribute('src')).toContain('camera-b.webp');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('2 / 2');

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a neutral icon for products without photos and lets the user change selection', async () => {
    const noPhoto = product({ id: 'product-2', name: 'Cable USB', images: [], imageUrl: undefined });
    await render(<ProductSearchSelect products={[noPhoto]} value="product-2" onChange={vi.fn()} />);
    expect(host.querySelector('[data-testid="selected-product-preview"] svg[aria-label="Sin imagen para Cable USB"]')).not.toBeNull();

    const changeButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Cambiar');
    await act(async () => { changeButton?.click(); });
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('keeps arrow and Enter selection available from the keyboard', async () => {
    const onChange = vi.fn();
    const products = [product(), product({ id: 'product-2', name: 'Cable USB', images: [] })];
    await render(<ProductSearchSelect products={products} value="" onChange={onChange} />);
    const input = host.querySelector('input:not([readonly])') as HTMLInputElement;
    await act(async () => { input.focus(); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('product-2');
  });
});

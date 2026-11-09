// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogConfig, Category, Product } from '../../types';
import CatalogCustomizer from './CatalogCustomizer';

const config: CatalogConfig = {
  id: 'config-1', ownerUid: 'owner-1', businessName: 'Tienda de prueba', slug: 'tienda-prueba',
  showPrices: true, showOutOfStock: false, showStock: true, showStockQuantity: false, enabled: true,
  welcomeMessage: '', primaryColor: '#3156a6', accentColor: '#3156a6', allowOrders: true,
  layout: 'Grid', fontStyle: 'Modern',
};
const product: Product = {
  id: 'product-1', name: 'Cable USB-C', categoryId: 'category-1', category: 'Cables',
  purchasePrice: 100, salePrice: 8500, stock: 3, minStock: 1, images: [], showInCatalog: true,
  inventoryOwnerId: 'owner-1', ownerUid: 'owner-1', createdAt: '2026-11-01', updatedAt: '2026-11-01',
};
const category: Category = { id: 'category-1', name: 'Cables', ownerUid: 'owner-1', createdAt: '2026-11-01' } as Category;

describe('CatalogCustomizer', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it('shows a compact catalog hub and saves offer mode changes with a success message', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    expect(host.textContent).toContain('Tu link');
    expect(host.textContent).toContain('Vista previa');
    expect(host.textContent).toContain('Destacados y ofertas');
    const openOffers = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Destacados y ofertas'));
    await act(async () => openOffers?.click());
    expect(host.textContent).toContain('Más vendidos');
    const bestSelling = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Más vendidos');
    await act(async () => bestSelling?.click());
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    expect(save?.disabled).toBe(false);
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ presentation: expect.objectContaining({ featuredMode: 'best_selling' }) }));
    expect(host.textContent).toContain('Cambios guardados');
  });

  it('edits the WhatsApp template with preview variables and keeps save disabled when unchanged', async () => {
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={vi.fn().mockResolvedValue(undefined)} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const saveInitially = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    expect(saveInitially?.disabled).toBe(true);
    const openWhatsApp = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('WhatsApp y pedidos'));
    await act(async () => openWhatsApp?.click());
    expect(host.textContent).toContain('Cable USB-C');
    expect(host.textContent).toContain('{producto}');
    expect(host.textContent).toContain('{precio}');
    expect(host.textContent).toContain('{link}');
    expect(host.textContent).toContain('+ cantidad');
  });

  it('defaults to hiding out-of-stock products and saves the catalog toggle', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openDisplay = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Qué se muestra'));
    await act(async () => openDisplay?.click());
    const showOutOfStock = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest('label')?.textContent?.includes('Mostrar productos sin stock'));
    expect(showOutOfStock?.checked).toBe(false);
    await act(async () => { showOutOfStock?.click(); });
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ showOutOfStock: true }));
  });

  it('previews category photos and persists a manually selected product photo', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const productWithPhoto = { ...product, images: ['https://assets.test/cable.webp'] };
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[category]} products={[productWithPhoto]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openDisplay = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Qué se muestra'));
    await act(async () => openDisplay?.click());
    const photoToggle = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest('label')?.textContent?.includes('Mostrar foto en las categorías'));
    expect(photoToggle?.checked).toBe(true);
    const selector = host.querySelector<HTMLSelectElement>('select[aria-label="Foto para Cables"]');
    expect(selector?.querySelector('option[value="https://assets.test/cable.webp"]')?.textContent).toBe('Cable USB-C');
    await act(async () => {
      if (!selector) return;
      selector.value = 'https://assets.test/cable.webp';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ categoryPhotoOverrides: { 'category-1': 'https://assets.test/cable.webp' } }));
  });

  it('shows the live catalog preview while editing the cover', async () => {
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={vi.fn()} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openCover = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Portada'));
    await act(async () => openCover?.click());
    expect(host.querySelector('[aria-label="Vista previa en vivo del catálogo"]')).not.toBeNull();
    expect(host.textContent).toContain('Encontrá lo que buscás');
  });
});

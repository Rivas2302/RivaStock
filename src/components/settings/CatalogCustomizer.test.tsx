// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogConfig, Category, Product } from '../../types';
import CatalogCustomizer from './CatalogCustomizer';

vi.mock('../../lib/catalogSlug', () => ({
  normalizeCatalogSlug: (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
  validateCatalogSlug: (value: string) => value.length < 3 || value.length > 40 ? 'El link debe tener entre 3 y 40 caracteres.' : null,
  isCatalogSlugConflict: (error: unknown) => /duplicate key|23505|catalog_slug_registry/i.test(error instanceof Error ? error.message : String(error)),
  isCatalogSlugAvailable: vi.fn().mockResolvedValue(true),
  suggestCatalogSlug: vi.fn(async (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-') || 'tienda-prueba'),
}));

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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

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

  it('suggests a name-based link without changing it when the business name changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openBusiness = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Datos del negocio'));
    await act(async () => openBusiness?.click());

    const businessName = [...host.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === 'Tienda de prueba');
    await act(async () => {
      if (businessName) setInputValue(businessName, 'Bazar Lucía');
    });

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Tu link"]')?.value).toBe('tienda-prueba');
    expect(host.textContent).toContain('Cambiar el nombre no modifica el link');
    const useBusinessName = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Usar el nombre del negocio'));
    expect(useBusinessName).toBeDefined();
    await act(async () => useBusinessName?.click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Tu link"]')?.value).toBe('bazar-lucia');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('returns to the catalog overview without a false unsaved-changes prompt after saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openBusiness = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Datos del negocio'));
    await act(async () => openBusiness?.click());
    const businessName = [...host.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === 'Tienda de prueba');
    await act(async () => { if (businessName) setInputValue(businessName, 'Tienda guardada'); });
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => save?.click());
    const back = host.querySelector<HTMLButtonElement>('button[aria-label="Volver a configuración del catálogo"]');
    await act(async () => back?.click());

    expect(confirm).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Tu catálogo');
  });

  it('shows a suggested free link when the database rejects a concurrent slug collision', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('duplicate key value violates unique constraint catalog_slug_registry_pkey'));
    const { suggestCatalogSlug } = await import('../../lib/catalogSlug');
    vi.mocked(suggestCatalogSlug).mockResolvedValueOnce('bazar-lucia-2');
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openBusiness = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Datos del negocio'));
    await act(async () => openBusiness?.click());
    const slugInput = host.querySelector<HTMLInputElement>('input[aria-label="Tu link"]');
    await act(async () => {
      if (slugInput) setInputValue(slugInput, 'bazar-lucia');
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => save?.click());

    expect(host.textContent).toContain('Ese link ya está en uso. Elegí una sugerencia');
    expect([...host.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent?.includes('Usar bazar-lucia-2'))).toBe(true);
  });

  it('enables save and persists a change to only the announcement ribbon color', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openTheme = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Tema y ambientación'));
    await act(async () => openTheme?.click());

    const ribbonMode = host.querySelector<HTMLSelectElement>('select[aria-label="Color de la cinta"]');
    await act(async () => {
      if (!ribbonMode) return;
      ribbonMode.value = 'custom';
      ribbonMode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const greenSuggestion = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === 'Verde');
    await act(async () => greenSuggestion?.click());

    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    expect(save?.disabled).toBe(false);
    await act(async () => save?.click());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ announcementColor: '#15803D' }));
    expect(host.textContent).toContain('Cambios guardados');
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

  it('configures the Todos photo first, previews it, and saves the override', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const productWithPhoto = { ...product, images: ['https://assets.test/cable.webp'] };
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[category]} products={[productWithPhoto]} canEdit onSave={onSave} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openDisplay = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Qué se muestra'));
    await act(async () => openDisplay?.click());

    const allPhotoSelector = host.querySelector<HTMLSelectElement>('select[aria-label="Foto para Todos"]');
    expect(allPhotoSelector?.options[0].textContent).toBe('Automática');
    expect(allPhotoSelector?.querySelector('option[value="https://assets.test/cable.webp"]')?.textContent).toBe('Cable USB-C');
    await act(async () => {
      if (!allPhotoSelector) return;
      allPhotoSelector.value = 'https://assets.test/cable.webp';
      allPhotoSelector.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="catalog-all-category-photo-preview"] img')?.getAttribute('src')).toBe('https://assets.test/cable.webp');
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ categoryPhotoOverrides: { all: 'https://assets.test/cable.webp' } }));
  });

  it('uploads and restores the automatic Todos photo', async () => {
    const onUploadCategoryPhoto = vi.fn().mockResolvedValue('https://assets.test/custom-all.webp');
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[{ ...product, images: ['https://assets.test/cable.webp'] }]} canEdit onSave={vi.fn()} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={onUploadCategoryPhoto}/>));
    const openDisplay = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Qué se muestra'));
    await act(async () => openDisplay?.click());

    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['image'], 'todos.webp', { type: 'image/webp' });
    await act(async () => {
      if (!fileInput) return;
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onUploadCategoryPhoto).toHaveBeenCalledWith(file);
    expect(host.querySelector('[data-testid="catalog-all-category-photo-preview"] img')?.getAttribute('src')).toBe('https://assets.test/custom-all.webp');

    const restore = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Volver a automática'));
    await act(async () => restore?.click());
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Foto para Todos"]')?.value).toBe('');
    expect(host.querySelector('[data-testid="catalog-all-category-photo-preview"] img')?.getAttribute('src')).toBe('https://assets.test/cable.webp');
  });

  it('shows the live catalog preview while editing the cover', async () => {
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={vi.fn()} onUploadCover={vi.fn()} onUploadLogo={vi.fn()} onUploadCategoryPhoto={vi.fn()}/>));
    const openCover = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Portada'));
    await act(async () => openCover?.click());
    expect(host.querySelector('[aria-label="Vista previa en vivo del catálogo"]')).not.toBeNull();
    expect(host.textContent).toContain('Encontrá lo que buscás');
  });
});

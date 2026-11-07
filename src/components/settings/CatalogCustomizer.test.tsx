// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogConfig, Product } from '../../types';
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

describe('CatalogCustomizer', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('saves theme ambience, announcement, and only explicit offer discounts', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CatalogCustomizer config={config} categories={[]} products={[product]} canEdit onSave={onSave} onUploadCover={vi.fn()}/>));
    const christmas = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Navidad'));
    await act(async () => christmas?.click());
    const animated = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Efectos animados en la pantalla'))?.querySelector('input');
    await act(async () => animated?.click());
    const announcement = host.querySelector<HTMLInputElement>('input[placeholder="Ej.: Envíos gratis en General Pico"]');
    await act(async () => {
      if (!announcement) throw new Error('Announcement field missing');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(announcement, 'Envíos gratis');
      announcement.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const includeOffer = host.querySelector<HTMLInputElement>('input[aria-label="Incluir Cable USB-C en Ofertas"]');
    await act(async () => includeOffer?.click());
    const discount = host.querySelector<HTMLInputElement>('input[aria-label="Descuento de Cable USB-C"]');
    await act(async () => {
      if (!discount) throw new Error('Discount field missing');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(discount, '20');
      discount.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      theme: 'christmas',
      ambience: expect.objectContaining({ animatedEffects: false, announcementText: 'Envíos gratis' }),
      offerProductIds: ['product-1'],
      offerDiscountPercentByProduct: { 'product-1': 20 },
    }));
  });
});

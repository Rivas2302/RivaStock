// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSuperOfferState } from '../../lib/superOffersApi';
import type { PriceList, PriceListItem, Product } from '../../types';

const apiMocks = vi.hoisted(() => ({
  getOwnerSuperOfferState: vi.fn(),
  saveSuperOfferBatch: vi.fn(),
  closeSuperOfferBatch: vi.fn(),
}));

vi.mock('../../lib/superOffersApi', () => apiMocks);

import SuperOffersManager from './SuperOffersManager';

const list = {
  id: 'list-qa', ownerUid: 'owner-qa', name: 'Revendedores', kind: 'reseller',
  defaultDiscountPercent: 20, publicEnabled: true, accessCodeConfigured: true,
  minimumRule: 'none', minimumOrderAmount: 0, minimumOrderQuantity: 0,
  minimumProfitMarginPercent: 0, targetResellerDiscountPercent: 0,
  createdAt: '', updatedAt: '',
} satisfies PriceList;

const product: Product = {
  id: 'product-qa', name: 'Producto QA', categoryId: '', category: 'Prueba',
  purchasePrice: 100, salePrice: 1000, stock: 0, minStock: 0,
  imageUrl: 'https://images.example/qa.webp', showInCatalog: false,
  ownerUid: 'owner-qa', createdAt: '', updatedAt: '',
};

const item: PriceListItem = {
  id: 'item-qa', ownerUid: 'owner-qa', priceListId: list.id, productId: product.id,
  pricingMode: 'fixed', discountPercent: null, fixedPrice: 700,
  availability: 'on_order', sortOrder: 0, createdAt: '', updatedAt: '',
};

const state = (overrides: Partial<OwnerSuperOfferState> = {}): OwnerSuperOfferState => ({
  batch: null,
  slug: 'negocio-qa',
  catalogEnabled: true,
  resellerEnabled: true,
  ...overrides,
});

describe('SuperOffersManager owner-state handling', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    apiMocks.getOwnerSuperOfferState.mockReset();
    apiMocks.saveSuperOfferBatch.mockReset();
    apiMocks.closeSuperOfferBatch.mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render() {
    await act(async () => root.render(
      <SuperOffersManager list={list} products={[product]} items={[item]} canWrite/>,
    ));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }

  it('shows only the RPC error and a retry button, then recovers on retry', async () => {
    apiMocks.getOwnerSuperOfferState
      .mockRejectedValueOnce(new Error('No se pudo leer el estado de Súper ofertas'))
      .mockResolvedValueOnce(state());
    await render();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo leer el estado de Súper ofertas');
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.querySelector('button')?.textContent).toBe('Reintentar');
    expect(host.textContent).not.toContain('publicá lo que falta');

    await act(async () => host.querySelector('button')?.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(apiMocks.getOwnerSuperOfferState).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Abrir tanda');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the server module denial as the only recovery state', async () => {
    apiMocks.getOwnerSuperOfferState.mockRejectedValueOnce(
      new Error('El módulo Revendedores no está incluido en tu plan'),
    );
    await render();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('El módulo Revendedores no está incluido en tu plan');
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.querySelector('button')?.textContent).toBe('Reintentar');
    expect(host.textContent).not.toContain('Publicá el catálogo');
  });

  it('only asks to publish the missing catalog and links directly to catalog settings', async () => {
    apiMocks.getOwnerSuperOfferState.mockResolvedValueOnce(state({ catalogEnabled: false }));
    await render();

    expect(host.textContent).toContain('Catálogo público sin publicar');
    expect(host.querySelector('a[href="/config?tab=catalog"]')?.textContent).toBe('Publicar catálogo');
    expect(host.textContent).not.toContain('Lista de Revendedores sin publicar');
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('links to the reseller publication settings when that list is unpublished', async () => {
    apiMocks.getOwnerSuperOfferState.mockResolvedValueOnce(state({ resellerEnabled: false }));
    await render();

    expect(host.textContent).toContain('Lista de Revendedores sin publicar');
    expect(host.querySelector('a[href="/revendedores?tab=settings"]')?.textContent).toBe('Publicar lista de Revendedores');
    expect(host.textContent).not.toContain('Catálogo público sin publicar');
  });

  it('defaults the previous price off and saves the owner choice with the batch', async () => {
    apiMocks.getOwnerSuperOfferState.mockResolvedValue(state());
    apiMocks.saveSuperOfferBatch.mockResolvedValue(undefined);
    await render();

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Mostrar precio anterior tachado"]');
    expect(toggle?.checked).toBe(false);

    await act(async () => { toggle?.click(); });
    expect(toggle?.checked).toBe(true);

    const openButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Abrir tanda'));
    await act(async () => { openButton?.click(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(apiMocks.saveSuperOfferBatch).toHaveBeenCalledWith(expect.objectContaining({
      showComparePrice: true,
      open: true,
    }));
  });

  it('restores the comparison setting saved on the batch', async () => {
    apiMocks.getOwnerSuperOfferState.mockResolvedValue(state({
      batch: {
        id: 'batch-qa', status: 'draft', selectionMode: 'all', extraPercent: 20,
        showComparePrice: true, shippingMode: 'fixed', shippingValue: 5000,
        endsAt: '2099-12-01T21:00:00.000Z', noticeColor: 'red',
        productIds: [], brandedProductIds: [], ordersCount: 0,
      },
    }));
    await render();

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Mostrar precio anterior tachado"]')?.checked).toBe(true);
  });
});

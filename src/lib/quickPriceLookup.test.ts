import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import {
  findProductByBarcode,
  getProductImage,
  getProductSku,
  getProductVariantModel,
  getVisibleQuickPriceProducts,
  initialQuickPriceLoadState,
  quickPriceLoadReducer,
  resolveSelectedProduct,
  searchProducts,
} from './quickPriceLookup';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-1',
  name: 'Auriculares Inalámbricos',
  categoryId: 'audio',
  category: 'Audio',
  purchasePrice: 100,
  salePrice: 200,
  stock: 7,
  minStock: 2,
  showInCatalog: true,
  barcode: '779123456',
  customFields: { SKU: 'AUR-M10', Variante: 'Negro', Modelo: 'M10' },
  ownerUid: 'owner-1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
});

const readyLoadState = (scopeKey: string, products = [product()]) => quickPriceLoadReducer(
  quickPriceLoadReducer(initialQuickPriceLoadState, { type: 'start', scopeKey }),
  { type: 'success', scopeKey, products, holdings: [] },
);

describe('quick price lookup', () => {
  it('matches an exact normalized barcode without mutating the product', () => {
    const item = product();

    expect(findProductByBarcode([item], ' 779123456 ')).toBe(item);
    expect(item.barcode).toBe('779123456');
  });

  it('searches names, categories, barcodes, SKUs and variant fields', () => {
    const item = product();

    expect(searchProducts([item], 'inalambricos')).toEqual([item]);
    expect(searchProducts([item], 'AUR-M10')).toEqual([item]);
    expect(searchProducts([item], 'negro')).toEqual([item]);
    expect(searchProducts([item], '779123')).toEqual([item]);
    expect(searchProducts([item], 'sin coincidencias')).toEqual([]);
  });

  it('extracts optional SKU, variant/model and image data safely', () => {
    const item = product({ images: ['', 'https://example.com/product.jpg'] });

    expect(getProductSku(item)).toBe('AUR-M10');
    expect(getProductVariantModel(item)).toBe('Negro · M10');
    expect(getProductImage(item)).toBe('https://example.com/product.jpg');
    expect(getProductImage(product({ imageUrl: 'https://example.com/main.jpg' })))
      .toBe('https://example.com/main.jpg');
  });

  it('limits holdings-mode lookup to products held by allowed inventory owners', () => {
    const visible = product({ id: 'visible' });
    const hidden = product({ id: 'hidden', name: 'Producto reservado' });
    const inactive = product({ id: 'inactive', name: 'Producto inactivo' });
    const holdings = [
      {
        id: 'holding-visible', ownerUid: 'owner-1', productId: visible.id,
        inventoryOwnerId: 'allowed-owner', stock: 2, purchaseCost: 100,
        minStock: 0, active: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
      {
        id: 'holding-hidden', ownerUid: 'owner-1', productId: hidden.id,
        inventoryOwnerId: 'other-owner', stock: 5, purchaseCost: 100,
        minStock: 0, active: true, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
      {
        id: 'holding-inactive', ownerUid: 'owner-1', productId: inactive.id,
        inventoryOwnerId: 'allowed-owner', stock: 5, purchaseCost: 100,
        minStock: 0, active: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
    ];

    expect(getVisibleQuickPriceProducts({
      products: [visible, hidden, inactive],
      holdings,
      holdingsEnabled: true,
      allowedInventoryOwnerIds: ['allowed-owner'],
    })).toEqual([visible]);
    expect(getVisibleQuickPriceProducts({
      products: [visible, hidden, inactive],
      holdings,
      holdingsEnabled: false,
      allowedInventoryOwnerIds: [],
    })).toEqual([visible, hidden, inactive]);
  });

  it('resolves selection from the latest visible catalog and drops stale IDs', () => {
    const initial = product({ salePrice: 200, imageUrl: 'old.jpg' });
    const refreshed = product({ salePrice: 350, imageUrl: 'new.jpg', name: 'Nombre actualizado' });

    expect(resolveSelectedProduct([initial], initial.id)).toBe(initial);
    expect(resolveSelectedProduct([refreshed], initial.id)).toBe(refreshed);
    expect(resolveSelectedProduct([], initial.id)).toBeNull();
  });

  it('finishes the blocking loader for populated and empty successful loads', () => {
    const scopeKey = 'owner-a|legacy|legacy|access-ok';
    const started = quickPriceLoadReducer(initialQuickPriceLoadState, {
      type: 'start',
      scopeKey,
    });
    const populated = quickPriceLoadReducer(started, {
      type: 'success',
      scopeKey,
      products: [product()],
      holdings: [],
    });
    const empty = quickPriceLoadReducer(started, {
      type: 'success',
      scopeKey,
      products: [],
      holdings: [],
    });

    expect(populated.status).toBe('ready');
    expect(populated.products).toHaveLength(1);
    expect(empty).toMatchObject({ status: 'ready', products: [], holdings: [], error: null });
  });

  it('finishes loading on failure and never blocks an existing catalog during refetch', () => {
    const scopeKey = 'owner-a|legacy|legacy|access-ok';
    const started = quickPriceLoadReducer(initialQuickPriceLoadState, {
      type: 'start',
      scopeKey,
    });
    const failed = quickPriceLoadReducer(started, {
      type: 'failure',
      scopeKey,
      error: 'Sin conexión',
    });
    const ready = readyLoadState(scopeKey);
    const refreshing = quickPriceLoadReducer(ready, { type: 'start', scopeKey });
    const backgroundFailure = quickPriceLoadReducer(refreshing, {
      type: 'failure',
      scopeKey,
      error: 'Timeout',
    });

    expect(failed).toMatchObject({ status: 'error', error: 'Sin conexión' });
    expect(refreshing.status).toBe('ready');
    expect(backgroundFailure).toBe(ready);
  });

  it('blocks and clears a ready catalog when the account scope changes', () => {
    const ownerAScope = 'owner-a|legacy|legacy|access-ok';
    const ownerBScope = 'owner-b|legacy|legacy|access-ok';
    const ownerAReady = readyLoadState(ownerAScope, [product({ ownerUid: 'owner-a' })]);

    const ownerBLoading = quickPriceLoadReducer(ownerAReady, {
      type: 'start',
      scopeKey: ownerBScope,
    });

    expect(ownerBLoading).toMatchObject({
      status: 'loading',
      scopeKey: ownerBScope,
      products: [],
      holdings: [],
      error: null,
    });
  });

  it('blocks and clears legacy products when switching to holdings scope', () => {
    const legacyScope = 'owner-a|legacy|legacy|access-ok';
    const holdingsScope = 'owner-a|holdings|allowed-owner|access-ok';
    const legacyReady = readyLoadState(legacyScope);

    const holdingsLoading = quickPriceLoadReducer(legacyReady, {
      type: 'start',
      scopeKey: holdingsScope,
    });

    expect(holdingsLoading).toMatchObject({
      status: 'loading',
      scopeKey: holdingsScope,
      products: [],
      holdings: [],
      error: null,
    });
  });
});

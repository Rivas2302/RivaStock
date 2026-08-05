import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

const { callRpcMock } = vi.hoisted(() => ({ callRpcMock: vi.fn() }));
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return { ...actual, callRpc: callRpcMock };
});

import { saveProductWithHoldings } from './inventoryHoldings';

describe('saveProductWithHoldings response handling', () => {
  beforeEach(() => {
    callRpcMock.mockReset();
  });

  function makeProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: 'p-1',
      ownerUid: 'u-1',
      name: 'Termo',
      categoryId: 'c-1',
      category: 'Bazar',
      purchasePrice: 0,
      salePrice: 1234,
      stock: 5,
      minStock: 0,
      showInCatalog: true,
      notes: '',
      images: [],
      inventoryOwnerId: 'o-1',
      createdAt: '2026-08-04T22:00:00Z',
      updatedAt: '2026-08-04T22:00:00Z',
      ...overrides,
    };
  }

  const validDrafts = [{ inventoryOwnerId: 'o-1', stock: 5, purchaseCost: 10, minStock: 0, active: true }];

  it('extracts product and holdings from a plain object response', async () => {
    callRpcMock.mockResolvedValueOnce({
      product: {
        id: 'p-1',
        user_id: 'u-1',
        name: 'Termo',
        category_id: 'c-1',
        category: 'Bazar',
        sale_price: 1234,
        stock: 5,
        image_url: null,
        images: [],
        show_in_catalog: true,
        notes: null,
        description: null,
        barcode: null,
        custom_fields: null,
        created_at: '2026-08-04T22:00:00Z',
        updated_at: '2026-08-04T22:00:00Z',
      },
      holdings: [
        {
          id: 'h-1',
          user_id: 'u-1',
          product_id: 'p-1',
          inventory_owner_id: 'o-1',
          stock: 5,
          purchase_cost: 10,
          min_stock: 0,
          active: true,
          created_at: '2026-08-04T22:00:00Z',
          updated_at: '2026-08-04T22:00:00Z',
        },
      ],
    });
    const result = await saveProductWithHoldings({
      product: makeProduct() as never,
      holdings: validDrafts as never,
      idempotencyKey: 'k1',
    });
    expect(result.product.id).toBe('p-1');
    expect(result.product.salePrice).toBe(1234);
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]?.inventoryOwnerId).toBe('o-1');
  });

  it('unwraps a single-element array wrapper from PostgREST', async () => {
    callRpcMock.mockResolvedValueOnce([{
      product: { id: 'p-2', sale_price: 200, stock: 3 },
      holdings: [],
    }]);
    const result = await saveProductWithHoldings({
      product: makeProduct({ id: 'p-2', salePrice: 200, stock: 3 }) as never,
      holdings: validDrafts as never,
      idempotencyKey: 'k2',
    });
    expect(result.product.id).toBe('p-2');
    expect(result.product.salePrice).toBe(200);
  });

  it('falls back to a default product when the RPC returns null', async () => {
    callRpcMock.mockResolvedValueOnce(null);
    const result = await saveProductWithHoldings({
      product: makeProduct({ id: 'fallback' }) as never,
      holdings: validDrafts as never,
      idempotencyKey: 'k3',
    });
    expect(result.product.id).toBe('fallback');
    expect(result.product.salePrice).toBe(1234);
    expect(result.holdings).toEqual([]);
  });
});

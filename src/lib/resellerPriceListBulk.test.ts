import { describe, expect, it, vi } from 'vitest';
import type { PriceListItem } from '../types';
import {
  applyResellerPriceListBulkMutations,
  getBulkActionProductIds,
  toPriceListBulkRow,
} from './resellerPriceListBulk';

function item(productId: string, availability: PriceListItem['availability'] = 'in_stock'): PriceListItem {
  return {
    id: `item-${productId}`,
    ownerUid: 'owner-1',
    priceListId: 'list-1',
    productId,
    pricingMode: 'discount',
    discountPercent: 15,
    fixedPrice: null,
    availability,
    sortOrder: 0,
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
  };
}

describe('reseller price list bulk actions', () => {
  it('selects only products whose inclusion or availability will change', () => {
    const included = item('included');
    const orderOnly = item('order-only', 'on_order');
    const productIds = ['included', 'order-only', 'excluded', 'excluded'];

    expect(getBulkActionProductIds('remove', productIds, [included, orderOnly])).toEqual(['included', 'order-only']);
    expect(getBulkActionProductIds('add', productIds, [included, orderOnly], new Set(['excluded']))).toEqual(['excluded']);
    expect(getBulkActionProductIds('on_order', productIds, [included, orderOnly])).toEqual(['included']);
  });

  it('serializes only price list fields, never stock or product fields', () => {
    expect(toPriceListBulkRow(item('p-1'))).toEqual({
      user_id: 'owner-1',
      price_list_id: 'list-1',
      product_id: 'p-1',
      pricing_mode: 'discount',
      discount_percent: 15,
      fixed_price: null,
      availability: 'in_stock',
      supplier_list_id: null,
      sort_order: 0,
    });
  });

  it('saves more than 1,000 selected rows in sequential batches of at most 100', async () => {
    const ids = Array.from({ length: 1_205 }, (_, index) => `product-${index + 1}`);
    const batches: string[][] = [];
    const progress: Array<{ completed: number; total: number }> = [];

    await applyResellerPriceListBulkMutations(
      [{ type: 'remove', productIds: ids }],
      async mutation => {
        if (mutation.type !== 'remove') throw new Error('Unexpected mutation');
        batches.push(mutation.productIds);
      },
      value => progress.push(value),
    );

    expect(batches).toHaveLength(13);
    expect(Math.max(...batches.map(batch => batch.length))).toBe(100);
    expect(batches.flat()).toEqual(ids);
    expect(progress.at(-1)).toEqual({ completed: 1_205, total: 1_205 });
  });

  it('applies and restores distinct suggested prices in bounded batches', async () => {
    const rows = [item('a'), item('b'), item('c')].map((entry, index) => ({
      ...entry,
      pricingMode: 'fixed' as const,
      discountPercent: null,
      fixedPrice: 1_400 + index * 100,
    }));
    const batches: Array<string[]> = [];
    await applyResellerPriceListBulkMutations(
      [{ type: 'prices', items: rows }],
      async mutation => {
        if (mutation.type !== 'prices') throw new Error('Unexpected mutation');
        batches.push(mutation.items.map(row => row.productId));
      },
      undefined,
      2,
    );
    expect(batches).toEqual([['a', 'b'], ['c']]);
    expect(toPriceListBulkRow(rows[0])).toMatchObject({ pricing_mode: 'fixed', discount_percent: null, fixed_price: 1_400 });
  });

  it('stops on the failed batch and reports completed progress for a safe retry', async () => {
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('raw database error'));
    const progress: Array<{ completed: number; total: number }> = [];

    await expect(applyResellerPriceListBulkMutations(
      [{ type: 'remove', productIds: ['a', 'b', 'c', 'd'] }],
      write,
      value => progress.push(value),
      2,
    )).rejects.toThrow('No se pudo guardar la tanda 2 de 4. Los cambios anteriores se conservaron; podés reintentar.');

    expect(write).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toEqual({ completed: 2, total: 4 });
  });
});

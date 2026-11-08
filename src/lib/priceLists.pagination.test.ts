import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, findBy } = vi.hoisted(() => ({ from: vi.fn(), findBy: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from } }));
vi.mock('./db', () => ({
  db: { findBy },
  fromDb: (row: Record<string, unknown>) => row,
  invalidateDbCache: vi.fn(),
}));

import { loadResellerSupplierListPricing, loadResellerSupplierLists } from './priceLists';

const supplierLists = [{ id: 'supplier-list-1', supplier_id: 'supplier-1', enabled: false }];
const supplierItems = Array.from({ length: 2_500 }, (_, index) => ({
  id: `item-${String(index + 1).padStart(4, '0')}`,
  supplier_list_id: 'supplier-list-1',
  product_id: index === 2_499 ? 'product-p47' : `product-${index + 1}`,
  sort_order: index,
}));
const supplierPricing = Array.from({ length: 2_500 }, (_, index) => ({
  supplier_list_id: 'supplier-list-1',
  product_id: `product-${String(index + 1).padStart(4, '0')}`,
  margin_percent: 20,
  updated_at: '2026-11-07T00:00:00.000Z',
}));
const orderColumns: Array<{ table: string; column: string }> = [];

beforeEach(() => {
  from.mockReset();
  findBy.mockReset();
  orderColumns.splice(0, orderColumns.length);
  findBy.mockResolvedValue([{ id: 'price-list-1' }]);
  from.mockImplementation((table: string) => {
    let start = 0;
    let end = 999;
    const rows = table === 'reseller_supplier_lists' ? supplierLists
      : table === 'reseller_supplier_list_pricing' ? supplierPricing : supplierItems;
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in']) builder[method] = () => builder;
    builder.order = (column: string) => { orderColumns.push({ table, column }); return builder; };
    builder.range = (offset: number, last: number) => { start = offset; end = last; return builder; };
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({
      data: rows.slice(start, end + 1), error: null,
    }).then(resolve, reject);
    return builder;
  });
});

describe('reseller supplier list item pagination', () => {
  it('loads every supplier list item past the 1,000-row server limit', async () => {
    const [supplierList] = await loadResellerSupplierLists('price-list-1');

    expect(supplierList.productIds).toHaveLength(2_500);
    expect(supplierList.productIds.at(-1)).toBe('product-p47');
    expect(from).toHaveBeenCalledTimes(4);
    expect(orderColumns).toContainEqual({ table: 'reseller_supplier_list_items', column: 'sort_order' });
    expect(orderColumns).toContainEqual({ table: 'reseller_supplier_list_items', column: 'id' });
  });

  it('loads every supplier pricing row with stable composite-key pages', async () => {
    const rows = await loadResellerSupplierListPricing(['supplier-list-1']);

    expect(rows).toHaveLength(2_500);
    expect(rows.at(-1)?.product_id).toBe('product-2500');
    expect(from).toHaveBeenCalledTimes(3);
    expect(orderColumns).toContainEqual({ table: 'reseller_supplier_list_pricing', column: 'supplier_list_id' });
    expect(orderColumns).toContainEqual({ table: 'reseller_supplier_list_pricing', column: 'product_id' });
  });
});

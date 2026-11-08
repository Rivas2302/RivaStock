import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from, rpc } }));
import { callRpc, clearDbCache, db, invalidateDbCache } from './db';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function rangeQuery(rows: Array<Record<string, unknown>>, calls: [string, unknown[]][] = [], error: unknown = null) {
  let start = 0;
  let end = 999;
  let limitCount: number | null = null;
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'gt', 'gte', 'lte']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
  }
  builder.limit = (limit: number) => { limitCount = limit; calls.push(['limit', [limit]]); return builder; };
  builder.range = (from: number, to: number) => { start = from; end = to; calls.push(['range', [from, to]]); return builder; };
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({
    data: error ? null : rows.slice(start, end + 1).slice(0, limitCount ?? undefined), error,
  }).then(resolve, reject);
  return builder;
}

function deferredRangeQuery(promise: Promise<unknown>) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'range']) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => promise.then(resolve, reject);
  return builder;
}

beforeEach(() => { clearDbCache(); from.mockReset(); rpc.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('query cache invalidation during requests', () => {
  it('bounds retained query results across long sessions', async () => {
    from.mockReturnValue(rangeQuery([{ id: 'result' }]));
    await db.find('products','name','old');
    for (let index=0; index<128; index++) await db.find('products','name',`search-${index}`);
    const calls = from.mock.calls.length;
    await db.find('products','name','search-127');
    expect(from.mock.calls.length).toBe(calls);
    await db.find('products','name','old');
    expect(from.mock.calls.length).toBe(calls+1);
  });
  it.each(['register_customer_payment_v2', 'reconcile_customer_balance', 'toggle_sale_status'])('invalidates the linked ledger and sale after %s', async (name) => {
    let revision = 'old';
    from.mockImplementation(() => rangeQuery([{ id: revision }]));
    expect(await db.list('sales')).toEqual([{id:'old'}]);
    expect(await db.list('customer_transactions')).toEqual([{id:'old'}]);
    revision = 'new';
    rpc.mockResolvedValue({data:null,error:null});
    await callRpc(name, {});
    expect(await db.list('sales')).toEqual([{id:'new'}]);
    expect(await db.list('customer_transactions')).toEqual([{id:'new'}]);
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('shares one bounded recovery attempt between simultaneous readers', async () => {
    vi.useFakeTimers();
    from.mockReturnValueOnce(rangeQuery([], [], { message: 'AbortError: Lock broken by another request' }));
    from.mockReturnValueOnce(rangeQuery([{ id: 'recovered' }]));
    const readers = Promise.all([db.list('inventory_owners'), db.list('inventory_owners')]);
    await vi.advanceTimersByTimeAsync(200);
    expect(await readers).toEqual([[{ id: 'recovered' }], [{ id: 'recovered' }]]);
    expect(from).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never replays a write when it encounters the same lock error', async () => {
    from.mockReturnValue({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'Lock broken by another request' } }) }) }) });
    await expect(db.create('products', { id: 'product-1' })).rejects.toThrow('Lock broken');
    expect(from).toHaveBeenCalledOnce();
  });
  it('does not let an old read replace a newer cached result', async () => {
    const old = deferred<{ data: { id: string }[]; error: null }>();
    from.mockReturnValueOnce(deferredRangeQuery(old.promise));
    const initial = db.list('products');
    invalidateDbCache('products');
    from.mockReturnValueOnce(rangeQuery([{ id: 'new' }]));
    await db.list('products');
    old.resolve({ data: [{ id: 'old' }], error: null });
    await initial;
    expect(await db.list('products')).toEqual([{ id: 'new' }]);
    expect(from).toHaveBeenCalledTimes(2);
  });
  it('does not repopulate cache after session clearing', async () => {
    const old = deferred<{ data: { id: string }[]; error: null }>();
    from.mockReturnValueOnce(deferredRangeQuery(old.promise));
    const pending = db.list('products');
    clearDbCache();
    old.resolve({ data: [{ id: 'old' }], error: null });
    await pending;
    from.mockReturnValueOnce(rangeQuery([]));
    expect(await db.list('products')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(2);
  });
  it('deduplicates simultaneous requests', async () => {
    from.mockReturnValue(rangeQuery([{ id: 'same' }]));
    const [a, b] = await Promise.all([db.list('products'), db.list('products')]);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe('collection reads beyond the PostgREST row cap', () => {
  const fixtures = Array.from({ length: 2_500 }, (_, index) => ({
    id: `product-${String(index + 1).padStart(4, '0')}`,
    user_id: 'owner',
    name: index === 2_499 ? 'Auricular Bluetooth P47' : `Fixture ${index + 1}`,
  }));

  it('loads all rows in stable 1,000-row pages from list and listColumns', async () => {
    const ranges: [string, unknown[]][] = [];
    from.mockImplementation(() => rangeQuery(fixtures, ranges));

    const listed = await db.list<{ id: string; userId: string; name: string }>('products', 'owner');
    expect(listed).toHaveLength(2_500);
    expect(listed.at(-1)).toMatchObject({ id: 'product-2500', name: 'Auricular Bluetooth P47' });
    expect(ranges.filter(([method]) => method === 'range')).toEqual([
      ['range', [0, 999]], ['range', [1_000, 1_999]], ['range', [2_000, 2_999]],
    ]);

    clearDbCache();
    ranges.splice(0, ranges.length);
    const selected = await db.listColumns<{ id: string; name: string }>('products', 'owner', 'id,name');
    expect(selected).toHaveLength(2_500);
    expect(selected.at(-1)).toMatchObject({ id: 'product-2500', name: 'Auricular Bluetooth P47' });
    expect(ranges.filter(([method]) => method === 'range')).toHaveLength(3);
  });

  it('paginates unbounded find and findBy reads while preserving explicitly limited lookups', async () => {
    const calls: [string, unknown[]][] = [];
    from.mockImplementation(() => rangeQuery(fixtures, calls));

    expect(await db.find('products', 'userId', 'owner')).toHaveLength(2_500);
    clearDbCache();
    expect(await db.findBy('products', [{ field: 'userId', value: 'owner' }])).toHaveLength(2_500);
    clearDbCache();
    expect(await db.find('products', 'userId', 'owner', 1)).toHaveLength(1);
  });
});

describe('recent paid sales query', () => {
  it('loads the complete financial ledger despite a lower server row cap', async () => {
    const calls: [string, unknown[]][] = [];
    const batches = [[{ id: 'a', amount: -10 }], [{ id: 'b', amount: -20 }], []];
    from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'gt']) {
        builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
      }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: batches.shift(), error: null }).then(resolve);
      return builder;
    });
    expect(await db.listAll('customer_transactions', 'account', [{field:'customerId',value:'customer'}]))
      .toEqual([{id:'a',amount:-10},{id:'b',amount:-20}]);
    expect(calls.filter(([method, args]) => method === 'eq' && args[0] === 'user_id')).toHaveLength(3);
    expect(calls.filter(([method, args]) => method === 'eq' && args[0] === 'customer_id')).toHaveLength(3);
    expect(calls).toContainEqual(['gt', ['id', 'a']]);
    expect(calls).toContainEqual(['gt', ['id', 'b']]);
  });
  it('continues past a server cap smaller than the requested batch and scopes every page', async () => {
    const calls: [string, unknown[]][] = [];
    const batches = [[{ id: 'a', product_id: 'one', quantity: 3 }], [{ id: 'b', product_id: 'two', quantity: 5 }], []];
    from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'gt']) {
        builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
      }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: batches.shift(), error: null }).then(resolve);
      return builder;
    });
    expect(await db.recentPaidSales('account', '2026-09-12', '2026-10-12')).toEqual([
      { id: 'a', productId: 'one', quantity: 3 }, { id: 'b', productId: 'two', quantity: 5 },
    ]);
    expect(calls.filter(([method, args]) => method === 'eq' && args[0] === 'user_id')).toHaveLength(3);
    expect(calls).toContainEqual(['gt', ['id', 'a']]);
    expect(calls).toContainEqual(['gt', ['id', 'b']]);
    expect(calls).toContainEqual(['gte', ['date', '2026-09-12']]);
    expect(calls).toContainEqual(['lte', ['date', '2026-10-12']]);
    expect(calls).toContainEqual(['eq', ['status', 'Pagado']]);
    expect(calls).toContainEqual(['select', ['id,date,status,product_id,quantity,items']]);
  });
});

describe('selected-column financial pagination', () => {
  it('pages every selected column with owner and filter scope on each request', async () => {
    const calls: [string, unknown[]][] = [];
    const batches = [[{ id: 'a', amount: 10 }], [{ id: 'b', amount: 20 }], []];
    from.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'gt']) {
        builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
      }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: batches.shift(), error: null }).then(resolve);
      return builder;
    });

    expect(await db.listAllColumns<{ id: string; amount: number }>(
      'cash_flow', 'account', 'id,amount', [{ field: 'status', value: 'Pagado' }],
    )).toEqual([{ id: 'a', amount: 10 }, { id: 'b', amount: 20 }]);
    expect(calls.filter(([method, args]) => method === 'select' && args[0] === 'id,amount')).toHaveLength(3);
    expect(calls.filter(([method, args]) => method === 'eq' && args[0] === 'user_id')).toHaveLength(3);
    expect(calls.filter(([method, args]) => method === 'eq' && args[0] === 'status')).toHaveLength(3);
    expect(calls).toContainEqual(['gt', ['id', 'a']]);
    expect(calls).toContainEqual(['gt', ['id', 'b']]);
  });

  it('rejects selected-column queries without the pagination key', async () => {
    await expect(db.listAllColumns('cash_flow', 'account', 'amount')).rejects.toThrow('requires the id column');
    expect(from).not.toHaveBeenCalled();
  });
});

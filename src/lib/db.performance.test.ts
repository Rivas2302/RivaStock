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

beforeEach(() => { clearDbCache(); from.mockReset(); rpc.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('query cache invalidation during requests', () => {
  it('bounds retained query results across long sessions', async () => {
    from.mockReturnValue({select:()=>({eq:()=>Promise.resolve({data:[{id:'result'}],error:null})})});
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
    from.mockImplementation(() => ({select: () => Promise.resolve({data:[{id:revision}],error:null})}));
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
    from.mockReturnValueOnce({ select: () => Promise.resolve({ data: null, error: { message: 'AbortError: Lock broken by another request' } }) });
    from.mockReturnValueOnce({ select: () => Promise.resolve({ data: [{ id: 'recovered' }], error: null }) });
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
    from.mockReturnValueOnce({ select: () => old.promise });
    const initial = db.list('products');
    invalidateDbCache('products');
    from.mockReturnValueOnce({ select: () => Promise.resolve({ data: [{ id: 'new' }], error: null }) });
    await db.list('products');
    old.resolve({ data: [{ id: 'old' }], error: null });
    await initial;
    expect(await db.list('products')).toEqual([{ id: 'new' }]);
    expect(from).toHaveBeenCalledTimes(2);
  });
  it('does not repopulate cache after session clearing', async () => {
    const old = deferred<{ data: { id: string }[]; error: null }>();
    from.mockReturnValueOnce({ select: () => old.promise });
    const pending = db.list('products');
    clearDbCache();
    old.resolve({ data: [{ id: 'old' }], error: null });
    await pending;
    from.mockReturnValueOnce({ select: () => Promise.resolve({ data: [], error: null }) });
    expect(await db.list('products')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(2);
  });
  it('deduplicates simultaneous requests', async () => {
    from.mockReturnValue({ select: () => Promise.resolve({ data: [{ id: 'same' }], error: null }) });
    const [a, b] = await Promise.all([db.list('products'), db.list('products')]);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(from).toHaveBeenCalledTimes(1);
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

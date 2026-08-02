import { supabase } from './supabase';
import { QUERY_CACHE_TTL_MS } from './constants';
import { uuid } from './utils';
import type { SalesReportData } from '../types';

// ─── Table name mapping (Firestore collection → Supabase table) ───────────────
const TABLE_MAP: Record<string, string> = {
  users:          'profiles',
  catalog_configs: 'catalog_config',
};

function tableName(col: string): string {
  return TABLE_MAP[col] ?? col;
}

interface CacheEntry {
  expiresAt: number;
  hasValue: boolean;
  promise?: Promise<unknown>;
  value?: unknown;
}

const queryCache = new Map<string, CacheEntry>();
const OFFLINE_QUEUE_KEY = 'rivastock:offline-mutations';
const OFFLINE_QUEUE_EVENT = 'rivastock:offline-queue-changed';

type OfflineMutation = {
  operation: 'create' | 'update' | 'delete';
  collectionName: string;
  id?: string;
  row?: Record<string, unknown>;
};

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function readOfflineQueue(): OfflineMutation[] {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) ?? '[]') as OfflineMutation[]; }
  catch { return []; }
}

function writeOfflineQueue(queue: OfflineMutation[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
}

export function getOfflineQueueSize(): number { return readOfflineQueue().length; }

export function subscribeToOfflineQueue(listener: () => void): () => void {
  window.addEventListener(OFFLINE_QUEUE_EVENT, listener);
  return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, listener);
}

const RPC_INVALIDATIONS: Record<string, string[]> = {
  convert_quote_to_sale: ['quotes', 'sales', 'cash_flow', 'products', 'customers'],
  delete_sale: ['sales', 'cash_flow', 'products', 'customers'],
  edit_sale: ['sales', 'cash_flow', 'products', 'customers'],
  intake_stock: ['products', 'stock_intakes'],
  reconcile_customer_balance: ['customers'],
  register_customer_payment: ['customers', 'cash_flow'],
  register_pos_sale: ['sales', 'cash_flow', 'products', 'customers'],
  register_sale: ['sales', 'cash_flow', 'products', 'customers'],
  toggle_sale_status: ['sales', 'cash_flow', 'customers'],
  register_supplier:    ['suppliers'],
  update_supplier:      ['suppliers'],
  delete_supplier:      ['suppliers'],
  toggle_supplier_active: ['suppliers'],
  create_inventory_owner: ['inventory_owners'],
  rename_inventory_owner: ['inventory_owners'],
  archive_inventory_owner: ['inventory_owners'],
  reorder_inventory_owners: ['inventory_owners'],
  mutate_inventory_holding_stock: ['inventory_holdings', 'inventory_stock_commands', 'products'],
  transfer_inventory_holding_stock: ['inventory_holdings', 'inventory_stock_commands', 'products'],
  set_inventory_holdings_enabled: ['inventory_operation_settings'],
  save_product_with_holdings: ['products', 'inventory_holdings', 'inventory_stock_commands'],
  receive_inventory_holding_stock: ['products', 'inventory_holdings', 'inventory_stock_commands', 'stock_intakes'],
};

// Report cache uses a different keyspace (date-range based) — we tag it
// separately so invalidateDbCache('sales') also evicts all report entries.
const REPORT_CACHE_PREFIX = 'salesReport';

function shallowClone<T>(value: T): T {
  if (Array.isArray(value)) return value.slice() as unknown as T;
  if (value && typeof value === 'object') return { ...(value as object) } as T;
  return value;
}

function cacheKey(operation: string, collectionName: string, params: unknown): string {
  return `${operation}:${tableName(collectionName)}:${JSON.stringify(params)}`;
}

export function clearDbCache(): void {
  queryCache.clear();
}

export function invalidateDbCache(...collectionNames: string[]): void {
  const tables = new Set(collectionNames.map(tableName));
  for (const key of queryCache.keys()) {
    const [namespace, table] = key.split(':', 3);
    if (namespace === REPORT_CACHE_PREFIX) {
      // Reports depend on sales + cash_flow + products; evict on any of those.
      if (tables.has('sales') || tables.has('cash_flow') || tables.has('products')) {
        queryCache.delete(key);
      }
      continue;
    }
    if (tables.has(table)) {
      queryCache.delete(key);
    }
  }
}

const PENDING_PROMISE_TIMEOUT_MS = 60_000;

function timeoutPromise<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `La base de datos tardó más de ${Math.round(ms / 1000)}s en responder. ` +
        `Probá recargar; si persiste, el proyecto puede estar en cold start (${label}).`
      ));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err)   => { clearTimeout(timer); reject(err); },
    );
  });
}

async function readWithCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = queryCache.get(key);

  if (existing?.hasValue && existing.expiresAt > now) {
    return shallowClone(existing.value as T);
  }

  if (existing?.promise) {
    try {
      const data = await timeoutPromise(existing.promise as Promise<T>, PENDING_PROMISE_TIMEOUT_MS, key);
      return shallowClone(data);
    } catch (err) {
      queryCache.delete(key);
      throw err;
    }
  }

  const pending = timeoutPromise(loader(), PENDING_PROMISE_TIMEOUT_MS, key);
  queryCache.set(key, {
    expiresAt: now + QUERY_CACHE_TTL_MS,
    hasValue: false,
    promise: pending,
  });

  try {
    const value = await pending;
    queryCache.set(key, {
      expiresAt: Date.now() + QUERY_CACHE_TTL_MS,
      hasValue: true,
      value,
    });
    return shallowClone(value);
  } catch (error) {
    queryCache.delete(key);
    throw error;
  }
}

// ─── camelCase ↔ snake_case helpers ──────────────────────────────────────────

// `email_contact` is intentionally snake_case in the application model. Audit
// events and the rest of the domain model, however, use camelCase timestamps.
const IDENTITY_FIELDS = new Set(['email_contact']);

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, m => '_' + m.toLowerCase());
}

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// TypeScript → DB column name
function colToDb(key: string, isProfile: boolean): string {
  if (key === 'ownerUid') return 'user_id';
  if (key === 'uid' && isProfile) return 'id';
  if (IDENTITY_FIELDS.has(key)) return key;
  return toSnake(key);
}

// DB column → TypeScript key
function colFromDb(key: string, isProfile: boolean): string {
  if (key === 'user_id') return 'ownerUid';
  if (key === 'id' && isProfile) return 'uid';
  if (IDENTITY_FIELDS.has(key)) return key;
  return toCamel(key);
}

/** Convert a TS camelCase object to a DB snake_case row */
export function toDb(obj: Record<string, unknown>, isProfile = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[colToDb(k, isProfile)] = v;
  }
  return out;
}

function enqueueOfflineMutation(mutation: OfflineMutation): void {
  writeOfflineQueue([...readOfflineQueue(), mutation]);
}

/** Convert a DB snake_case row to a TS camelCase object */
export function fromDb<T>(row: Record<string, unknown>, isProfile = false): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[colFromDb(k, isProfile)] = v;
  }
  return out as T;
}

function reportRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function reportText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function reportNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Normalize the RPC payload for both current and legacy snake_case keys. */
export function normalizeSalesReport(data: unknown): SalesReportData {
  const raw = reportRecord(data);
  const kpis = reportRecord(raw.kpis);
  const range = reportRecord(raw.range);

  return {
    kpis: {
      totalSales: reportNumber(kpis.totalSales ?? kpis.total_sales),
      transactionCount: reportNumber(kpis.transactionCount ?? kpis.transaction_count),
      paidCount: reportNumber(kpis.paidCount ?? kpis.paid_count),
      pendingCount: reportNumber(kpis.pendingCount ?? kpis.pending_count),
      averageTicket: reportNumber(kpis.averageTicket ?? kpis.average_ticket),
      pendingAmount: reportNumber(kpis.pendingAmount ?? kpis.pending_amount),
    },
    daily: (Array.isArray(raw.daily) ? raw.daily : []).map((point) => {
      const row = reportRecord(point);
      return {
        date: reportText(row.date),
        total: reportNumber(row.total),
        count: reportNumber(row.count ?? row.cnt),
      };
    }),
    byPayment: (Array.isArray(raw.byPayment) ? raw.byPayment : []).map((payment) => {
      const row = reportRecord(payment);
      return {
        paymentMethod: reportText(row.paymentMethod ?? row.payment_method, 'Sin especificar') as SalesReportData['byPayment'][number]['paymentMethod'],
        total: reportNumber(row.total),
        count: reportNumber(row.count ?? row.cnt),
      };
    }),
    topProducts: (Array.isArray(raw.topProducts) ? raw.topProducts : []).map((product) => {
      const row = reportRecord(product);
      return {
        productId: reportText(row.productId ?? row.product_id),
        productName: reportText(row.productName ?? row.product_name, 'Producto sin nombre'),
        quantity: reportNumber(row.quantity),
        revenue: reportNumber(row.revenue),
      };
    }),
    sales: (Array.isArray(raw.sales) ? raw.sales : []).map((sale) => {
      const row = reportRecord(sale);
      return {
        id: reportText(row.id),
        date: reportText(row.date),
        productName: reportText(row.productName ?? row.product_name, 'Producto sin nombre'),
        quantity: reportNumber(row.quantity),
        unitPrice: reportNumber(row.unitPrice ?? row.unit_price),
        total: reportNumber(row.total),
        paymentMethod: reportText(row.paymentMethod ?? row.payment_method, 'Sin especificar') as SalesReportData['byPayment'][number]['paymentMethod'],
        status: reportText(row.status) as SalesReportData['sales'][number]['status'],
        client: typeof row.client === 'string' ? row.client : null,
        source: typeof row.source === 'string' ? row.source as SalesReportData['sales'][number]['source'] : null,
      };
    }),
    range: {
      from: reportText(range.from),
      to: reportText(range.to),
    },
  };
}

// ─── SupabaseDB — same public interface as old FirebaseDB ─────────────────────

class SupabaseDB {
  private isProfile(col: string): boolean {
    return tableName(col) === 'profiles';
  }

  async list<T>(collectionName: string, ownerUid?: string): Promise<T[]> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);
    const key = cacheKey('list', collectionName, { ownerUid: ownerUid ?? null });

    return readWithCache(key, async () => {
      let q = supabase.from(tbl).select('*');
      if (ownerUid && !ip) {
        q = q.eq('user_id', ownerUid);
      }

      const { data, error } = await q;
      if (error) throw new Error(`[db.list:${tbl}] ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map(r => fromDb<T>(r, ip));
    });
  }

  async listColumns<T>(collectionName: string, ownerUid: string | undefined, columns: string): Promise<T[]> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);
    const selectedColumns = columns.trim() || '*';
    const key = cacheKey('listColumns', collectionName, { ownerUid: ownerUid ?? null, columns: selectedColumns });

    return readWithCache(key, async () => {
      let q = supabase.from(tbl).select(selectedColumns);
      if (ownerUid && !ip) {
        q = q.eq('user_id', ownerUid);
      }

      const { data, error } = await q;
      if (error) throw new Error(`[db.listColumns:${tbl}] ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map(r => fromDb<T>(r, ip));
    });
  }

  async find<T>(
    collectionName: string,
    field: string,
    value: unknown,
    limitCount?: number,
  ): Promise<T[]> {
    const tbl      = tableName(collectionName);
    const ip       = this.isProfile(collectionName);
    const dbField  = colToDb(field, ip);
    const key = cacheKey('find', collectionName, { field: dbField, value, limitCount: limitCount ?? null });

    return readWithCache(key, async () => {
      let q = supabase.from(tbl).select('*').eq(dbField, value as string);
      if (limitCount) q = q.limit(limitCount);

      const { data, error } = await q;
      if (error) throw new Error(`[db.find:${tbl}] ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map(r => fromDb<T>(r, ip));
    });
  }

  async findBy<T>(
    collectionName: string,
    filters: { field: string; value: unknown }[],
    limitCount?: number,
  ): Promise<T[]> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);
    const normalizedFilters = filters.map((filter) => ({
      field: colToDb(filter.field, ip),
      value: filter.value,
    }));
    const key = cacheKey('findBy', collectionName, {
      filters: normalizedFilters,
      limitCount: limitCount ?? null,
    });

    return readWithCache(key, async () => {
      let q = supabase.from(tbl).select('*');
      for (const filter of normalizedFilters) {
        q = q.eq(filter.field, filter.value as string);
      }
      if (limitCount) q = q.limit(limitCount);

      const { data, error } = await q;
      if (error) throw new Error(`[db.findBy:${tbl}] ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map(r => fromDb<T>(r, ip));
    });
  }

  async get<T>(collectionName: string, id: string): Promise<T | null> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);
    const key = cacheKey('get', collectionName, { id });

    return readWithCache(key, async () => {
      const { data, error } = await supabase
        .from(tbl)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // row not found
        throw new Error(`[db.get:${tbl}/${id}] ${error.message}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fromDb<T>(data as any, ip);
    });
  }

  async create<T extends { id?: string; uid?: string }>(
    collectionName: string,
    item: T,
  ): Promise<T> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);
    const row = toDb(item as Record<string, unknown>, ip);

    // Profiles use `id` as PK (set externally by auth trigger); other tables
    // use `id` from the item or let Postgres generate one.
    if (!row['id'] && !ip) {
      row['id'] = uuid();
    }

    if (isOffline()) {
      enqueueOfflineMutation({ operation: 'create', collectionName, row });
      invalidateDbCache(collectionName);
      return item as T;
    }

    const { data, error } = await supabase
      .from(tbl)
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`[db.create:${tbl}] ${error.message}`);
    invalidateDbCache(collectionName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fromDb<T>(data as any, ip);
  }

  async update<T>(collectionName: string, id: string, updates: unknown): Promise<T> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);
    const row = toDb(updates as Record<string, unknown>, ip);

    if (isOffline()) {
      enqueueOfflineMutation({ operation: 'update', collectionName, id, row });
      invalidateDbCache(collectionName);
      return { id, ...(updates as Record<string, unknown>) } as T;
    }

    const { data, error } = await supabase
      .from(tbl)
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`[db.update:${tbl}/${id}] ${error.message}`);
    invalidateDbCache(collectionName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fromDb<T>(data as any, ip);
  }

  async delete(collectionName: string, id: string): Promise<void> {
    const tbl = tableName(collectionName);

    if (isOffline()) {
      enqueueOfflineMutation({ operation: 'delete', collectionName, id });
      invalidateDbCache(collectionName);
      return;
    }

    const { error } = await supabase.from(tbl).delete().eq('id', id);
    if (error) throw new Error(`[db.delete:${tbl}/${id}] ${error.message}`);
    invalidateDbCache(collectionName);
  }

  async listByDateRange<T>(collectionName: string, ownerUid: string, from: string, to: string): Promise<T[]> {
    const tbl = tableName(collectionName);
    const key = cacheKey('listRange', collectionName, { ownerUid, from, to });
    return readWithCache(key, async () => {
      const { data, error } = await supabase.from(tbl).select('*')
        .eq('user_id', ownerUid)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: false });
      if (error) throw new Error(`[db.listByDateRange:${tbl}] ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map(r => fromDb<T>(r));
    });
  }

  /**
   * Aggregated sales report for the Reports/Analytics page.
   *
   * Calls the `get_sales_report(p_from, p_to)` RPC, which itself resolves the
   * owner via `get_owner_uid(auth.uid())` (so collaborators transparently see
   * the owner's data) and validates `ventas.read` permission on the server.
   *
   * The `ownerUid` arg is unused server-side (RPC uses auth.uid) but we keep
   * it in the cache key for symmetry with other helpers and to make cache
   * collisions across tenants impossible (defence in depth: any change to the
   * resolved owner — e.g. logout/login as a different collaborator — yields a
   * fresh key).
   */
  async getSalesReport(ownerUid: string, from: string, to: string): Promise<SalesReportData> {
    const key = `${REPORT_CACHE_PREFIX}:${ownerUid}:${from}:${to}`;
    return readWithCache(key, async () => {
      const { data, error } = await supabase.rpc('get_sales_report', {
        p_from: from,
        p_to:   to,
      });
      if (error) throw new Error(`[db.getSalesReport] ${error.message}`);
      return normalizeSalesReport(data);
    });
  }

  async getUniqueSlug(baseSlug: string, collectionName: string): Promise<string> {
    const tbl   = tableName(collectionName);
    const field = tbl === 'profiles' ? 'catalog_slug' : 'slug';

    let slug    = baseSlug;
    let counter = 1;
    while (counter <= 100) {
      const { data } = await supabase
        .from(tbl)
        .select(field)
        .eq(field, slug)
        .limit(1);

      if (!data || data.length === 0) return slug;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    return slug;
  }
}

export const db = new SupabaseDB();

export async function syncOfflineMutations(): Promise<void> {
  if (isOffline()) return;
  const queue = readOfflineQueue();
  const remaining: OfflineMutation[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const mutation = queue[index];
    const table = tableName(mutation.collectionName);
    let error: Error | null = null;

    if (mutation.operation === 'create') {
      const result = await supabase.from(table).insert(mutation.row ?? {});
      error = result.error;
    } else if (mutation.operation === 'update') {
      const result = await supabase.from(table).update(mutation.row ?? {}).eq('id', mutation.id ?? '');
      error = result.error;
    } else {
      const result = await supabase.from(table).delete().eq('id', mutation.id ?? '');
      error = result.error;
    }

    if (error) {
      remaining.push(...queue.slice(index));
      break;
    }
    invalidateDbCache(mutation.collectionName);
  }

  writeOfflineQueue(remaining);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void syncOfflineMutations(); });
}

// ─── RPC helper ───────────────────────────────────────────────────────────────

export async function callRpc<T>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(`[rpc:${name}] ${error.message}`);
  const invalidations = RPC_INVALIDATIONS[name];
  if (invalidations) invalidateDbCache(...invalidations);
  return data as T;
}

// ─── Supabase Storage helpers ─────────────────────────────────────────────────

export async function uploadToStorage(
  path: string,
  file: Blob,
  contentType?: string,
): Promise<string> {
  const { error } = await supabase.storage
    .from('assets')
    .upload(path, file, { contentType, upsert: true });

  if (error) throw new Error(`[storage.upload:${path}] ${error.message}`);

  const { data } = supabase.storage.from('assets').getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFromStorage(pathOrUrl: string): Promise<void> {
  let storagePath: string;
  if (pathOrUrl.startsWith('http')) {
    const match = pathOrUrl.match(/\/assets\/(.+?)(\?|$)/);
    if (!match) {
      console.error('[storage.delete] URL no parseable:', pathOrUrl);
      return;
    }
    storagePath = decodeURIComponent(match[1]);
  } else {
    storagePath = pathOrUrl;
  }
  const { error } = await supabase.storage.from('assets').remove([storagePath]);
  if (error) console.error(`[storage.delete:${storagePath}]`, error.message);
}

// ─── Re-export supabase client ────────────────────────────────────────────────
export { supabase };

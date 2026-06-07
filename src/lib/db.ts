import { supabase } from './supabase';
import { QUERY_CACHE_TTL_MS } from './constants';
import { uuid } from './utils';

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
};

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
    const [, table] = key.split(':', 3);
    if (tables.has(table)) {
      queryCache.delete(key);
    }
  }
}

const PENDING_PROMISE_TIMEOUT_MS = 20_000;

function timeoutPromise<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[db] timeout after ${ms}ms: ${label}`));
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

const IDENTITY_FIELDS = new Set(['email_contact', 'created_at', 'updated_at']);

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

/** Convert a DB snake_case row to a TS camelCase object */
export function fromDb<T>(row: Record<string, unknown>, isProfile = false): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[colFromDb(k, isProfile)] = v;
  }
  return out as T;
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

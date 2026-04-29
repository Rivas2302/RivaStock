import { supabase } from './supabase';

// ─── Table name mapping (Firestore collection → Supabase table) ───────────────
const TABLE_MAP: Record<string, string> = {
  users:          'profiles',
  catalog_configs: 'catalog_config',
};

function tableName(col: string): string {
  return TABLE_MAP[col] ?? col;
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

    let q = supabase.from(tbl).select('*');
    if (ownerUid && !ip) {
      q = q.eq('user_id', ownerUid);
    }

    const { data, error } = await q;
    if (error) throw new Error(`[db.list:${tbl}] ${error.message}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map(r => fromDb<T>(r, ip));
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

    let q = supabase.from(tbl).select('*').eq(dbField, value as string);
    if (limitCount) q = q.limit(limitCount);

    const { data, error } = await q;
    if (error) throw new Error(`[db.find:${tbl}] ${error.message}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map(r => fromDb<T>(r, ip));
  }

  async findBy<T>(
    collectionName: string,
    filters: { field: string; value: unknown }[],
    limitCount?: number,
  ): Promise<T[]> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);

    let q = supabase.from(tbl).select('*');
    for (const f of filters) {
      q = q.eq(colToDb(f.field, ip), f.value as string);
    }
    if (limitCount) q = q.limit(limitCount);

    const { data, error } = await q;
    if (error) throw new Error(`[db.findBy:${tbl}] ${error.message}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map(r => fromDb<T>(r, ip));
  }

  async get<T>(collectionName: string, id: string): Promise<T | null> {
    const tbl = tableName(collectionName);
    const ip  = this.isProfile(collectionName);

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
      row['id'] = crypto.randomUUID();
    }

    const { data, error } = await supabase
      .from(tbl)
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`[db.create:${tbl}] ${error.message}`);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fromDb<T>(data as any, ip);
  }

  async delete(collectionName: string, id: string): Promise<void> {
    const tbl = tableName(collectionName);

    const { error } = await supabase.from(tbl).delete().eq('id', id);
    if (error) throw new Error(`[db.delete:${tbl}/${id}] ${error.message}`);
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
  return data as T;
}

// ─── Supabase Storage helpers (replaces Firebase Storage exports) ─────────────

export { supabase as storage };

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

export async function deleteFromStorage(path: string): Promise<void> {
  // Extract just the path component from a full public URL if needed
  const storagePath = path.includes('/storage/v1/object/public/assets/')
    ? path.split('/storage/v1/object/public/assets/')[1]
    : path;

  const { error } = await supabase.storage.from('assets').remove([storagePath]);
  if (error) console.error(`[storage.delete:${storagePath}]`, error.message);
}

// ─── Re-export supabase client ────────────────────────────────────────────────
export { supabase };
export { supabase as supabaseAuth };

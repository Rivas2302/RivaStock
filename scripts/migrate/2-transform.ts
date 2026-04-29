/**
 * Step 2 — Transform Firestore documents to Supabase row format
 *
 * Handles camelCase → snake_case conversion and special field mappings:
 *   ownerUid  → user_id
 *   uid       → id  (profiles only)
 *   email_contact stays as-is
 *
 * Output: transformed/<tableName>.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const DUMP_DIR    = resolve('./dump');
const OUT_DIR     = resolve('./transformed');
mkdirSync(OUT_DIR, { recursive: true });

// camelCase → snake_case (simple, handles sequences like "productId" → "product_id")
function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase();
}

// Convert a raw Firestore document object to a Supabase row.
// isProfile = true → map uid→id instead of uid→uid
function transform(doc: Record<string, unknown>, isProfile = false): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    let col: string;
    if (k === 'ownerUid') {
      col = 'user_id';
    } else if (k === 'uid' && isProfile) {
      col = 'id';
    } else if (k === 'email_contact') {
      col = 'email_contact';
    } else {
      col = toSnake(k);
    }
    // Convert Firestore Timestamps or {_seconds, _nanoseconds} objects
    if (v && typeof v === 'object' && '_seconds' in (v as object)) {
      const ts = v as { _seconds: number };
      row[col] = new Date(ts._seconds * 1000).toISOString();
    } else {
      row[col] = v;
    }
  }
  return row;
}

// Table name mapping (Firestore collection → Supabase table)
const TABLE_MAP: Record<string, string> = {
  users:        'profiles',
  catalog_configs: 'catalog_config',
};

function tableFor(col: string): string {
  return TABLE_MAP[col] ?? col;
}

const COLLECTIONS = [
  'users',
  'categories',
  'price_ranges',
  'products',
  'sales',
  'cash_flow',
  'stock_intakes',
  'customers',
  'customer_transactions',
  'quotes',
  'orders',
  'catalog_configs',
];

console.log('=== RivaStock: Transform ===\n');

for (const col of COLLECTIONS) {
  const srcPath = `${DUMP_DIR}/${col}.json`;
  if (!existsSync(srcPath)) {
    console.log(`  SKIP ${col}: dump file not found`);
    continue;
  }

  const docs: Record<string, unknown>[] = JSON.parse(readFileSync(srcPath, 'utf8'));
  const isProfile = col === 'users';
  const rows = docs.map(d => transform(d, isProfile));

  const tableName = tableFor(col);
  const outPath = `${OUT_DIR}/${tableName}.json`;
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`  ${col} → ${tableName}: ${rows.length} rows`);
}

console.log('\nDone. Files written to ./transformed/');

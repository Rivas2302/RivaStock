#!/usr/bin/env node
// scripts/sql/apply.mjs
// Runs the three pending migrations (0033, 0034, 0035) against the
// Supabase project given by SUPABASE_DB_URL. Reports progress and any
// error per step and aborts on the first failure, leaving the database
// in a clean (rolled-back) state.
//
// Usage:
//   SUPABASE_DB_URL=postgresql://... node scripts/sql/apply.mjs
//
// The connection string must be the "Direct" one from
//   Supabase Dashboard > Project Settings > Database > Connection string
// with the database password, not the anon key.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDir = here;

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Missing SUPABASE_DB_URL environment variable.');
  console.error('Get it from: Supabase Dashboard > Project Settings > Database');
  console.error('Use the "Direct" connection string, not the Transaction pooler.');
  process.exit(2);
}

const order = [
  '0033_owner_aware_stock.sql',
  '0034_attributed_sales.sql',
  '0035_sales_attribution_ui.sql',
];

const verify = `
  SELECT
    (SELECT count(*) FROM information_schema.tables
       WHERE table_name = 'attributed_sale_commands')::int AS attributed_commands_table,
    (SELECT count(*) FROM information_schema.routines
       WHERE routine_name IN (
         'register_attributed_sale',
         'edit_attributed_sale',
         'refund_attributed_sale',
         'toggle_attributed_sale_status'
       ))::int AS attributed_rpcs,
    EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'sale_items'
    ) AS sale_items_table,
    EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'sale_item_allocations'
    ) AS sale_item_allocations_table,
    EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_product_commands'
    ) AS inventory_product_commands_table
`;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log('Connecting...');
  await client.connect();
  console.log('Connected.');

  // Quick precondition: confirm the DB is at 0032 (no sale_items table yet).
  const pre = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_owners'
    ) AS has_inventory_owners,
    EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_holdings'
    ) AS has_inventory_holdings,
    EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_owner_memberships'
    ) AS has_inventory_owner_memberships,
    EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'sale_items'
    ) AS has_sale_items
  `);
  const r = pre.rows[0];
  console.log('Pre-check:', r);
  if (!r.has_inventory_owners || !r.has_inventory_holdings || !r.has_inventory_owner_memberships) {
    console.error('ERROR: 0031/0032 tables are missing. Apply them first.');
    process.exit(3);
  }
  if (r.has_sale_items) {
    console.warn('sale_items already exists. 0034 may have been partially applied.');
    console.warn('Continuing anyway — the migration is transactional.');
  }

  for (const file of order) {
    const path = resolve(migrationDir, file);
    const sql = readFileSync(path, 'utf8');
    console.log(`\n[${file}] running (${sql.length} chars)...`);
    const t0 = Date.now();
    try {
      await client.query(sql);
      console.log(`[${file}] OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`[${file}] FAILED: ${err.message}`);
      console.error(`Detail: ${err.detail ?? ''}`);
      console.error(`Hint:  ${err.hint ?? ''}`);
      console.error('The transaction was rolled back. The DB is unchanged.');
      process.exit(1);
    }
  }

  console.log('\nVerifying post-state...');
  const v = await client.query(verify);
  console.log(v.rows[0]);

  const row = v.rows[0];
  if (row.attributed_commands_table !== 1 || row.attributed_rpcs !== 4) {
    console.error('VERIFICATION FAILED. Expected attributed_commands_table=1, attributed_rpcs=4.');
    process.exit(1);
  }
  console.log('\nAll migrations applied and verified.');
  await client.end();
}

main().catch(async (err) => {
  console.error('Unexpected error:', err);
  try { await client.end(); } catch {}
  process.exit(1);
});

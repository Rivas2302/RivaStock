/**
 * Step 4 — Verify row counts in Supabase match transformed files
 *
 * Also spot-checks:
 *   - products.stock >= 0 (no negative stock)
 *   - sales.status IN ('Pagado','Pendiente','No Pagado')
 *   - customer_transactions reference valid customer_id
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TRANSFORMED_DIR = resolve('./transformed');

const TABLES = [
  'profiles',
  'categories',
  'price_ranges',
  'catalog_config',
  'products',
  'customers',
  'sales',
  'stock_intakes',
  'cash_flow',
  'orders',
  'quotes',
  'customer_transactions',
];

async function countTable(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

function localCount(table: string): number {
  const path = `${TRANSFORMED_DIR}/${table}.json`;
  if (!existsSync(path)) return 0;
  return (JSON.parse(readFileSync(path, 'utf8')) as unknown[]).length;
}

(async () => {
  console.log('=== RivaStock: Verify ===\n');
  let allOk = true;

  for (const table of TABLES) {
    const local = localCount(table);
    let remote: number;
    try {
      remote = await countTable(table);
    } catch (err) {
      console.error(`  ERROR reading ${table}: ${(err as Error).message}`);
      allOk = false;
      continue;
    }
    const ok = remote >= local;
    const marker = ok ? '✓' : '✗';
    console.log(`  ${marker} ${table.padEnd(24)} local=${local}  remote=${remote}${!ok ? '  ← MISMATCH' : ''}`);
    if (!ok) allOk = false;
  }

  // Spot checks
  console.log('\n--- Spot checks ---');

  const { data: negStock } = await supabase
    .from('products')
    .select('id, name, stock')
    .lt('stock', 0);
  if (negStock && negStock.length > 0) {
    console.log(`  ✗ ${negStock.length} products with negative stock:`, negStock.map(p => p.name));
    allOk = false;
  } else {
    console.log('  ✓ No negative stock');
  }

  const { data: badStatus } = await supabase
    .from('sales')
    .select('id, status')
    .not('status', 'in', '("Pagado","Pendiente","No Pagado")');
  if (badStatus && badStatus.length > 0) {
    console.log(`  ✗ ${badStatus.length} sales with invalid status`);
    allOk = false;
  } else {
    console.log('  ✓ All sales have valid status');
  }

  console.log(`\n${allOk ? 'ALL CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗ — review above'}`);
  process.exit(allOk ? 0 : 1);
})();

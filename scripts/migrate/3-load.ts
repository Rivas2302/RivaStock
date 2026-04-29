/**
 * Step 3 — Load transformed data into Supabase
 *
 * Uses service role key to bypass RLS.
 * Inserts in batches of 500, upsert mode (on_conflict=id) so re-runs are safe.
 *
 * Order matters for FK constraints:
 *   profiles → categories, price_ranges, products, customers
 *   → catalog_config, sales, stock_intakes, cash_flow, orders, quotes
 *   → customer_transactions
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
const BATCH_SIZE = 500;

// Load order respects FK dependencies
const LOAD_ORDER = [
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

async function loadTable(table: string): Promise<void> {
  const filePath = `${TRANSFORMED_DIR}/${table}.json`;
  if (!existsSync(filePath)) {
    console.log(`  SKIP ${table}: transformed file not found`);
    return;
  }

  const rows: Record<string, unknown>[] = JSON.parse(readFileSync(filePath, 'utf8'));
  if (rows.length === 0) {
    console.log(`  SKIP ${table}: empty`);
    return;
  }

  console.log(`  Loading ${table}: ${rows.length} rows...`);
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`    ERROR batch ${i}–${i + batch.length}: ${error.message}`);
      // Continue loading remaining batches
    } else {
      inserted += batch.length;
    }
  }

  console.log(`    → ${inserted}/${rows.length} rows loaded`);
}

(async () => {
  console.log('=== RivaStock: Load into Supabase ===\n');
  for (const table of LOAD_ORDER) {
    await loadTable(table);
  }
  console.log('\nDone.');
})();

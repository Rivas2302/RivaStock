/**
 * Step 1 — Export all Firestore collections to dump/*.json
 *
 * Usage:
 *   cp .env.example .env   # fill in credentials
 *   npm install
 *   tsx 1-export.ts
 *
 * Output: dump/<collectionName>.json  (one file per collection)
 */

import { Firestore } from '@google-cloud/firestore';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import 'dotenv/config';

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

const db = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const DUMP_DIR = resolve('./dump');
mkdirSync(DUMP_DIR, { recursive: true });

async function exportCollection(name: string) {
  console.log(`  Exporting ${name}...`);
  const snapshot = await db.collection(name).get();
  const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  writeFileSync(`${DUMP_DIR}/${name}.json`, JSON.stringify(docs, null, 2));
  console.log(`    → ${docs.length} documents`);
}

(async () => {
  console.log('=== RivaStock: Firestore Export ===\n');
  for (const col of COLLECTIONS) {
    try {
      await exportCollection(col);
    } catch (err) {
      console.warn(`  SKIP ${col}: ${(err as Error).message}`);
    }
  }
  console.log('\nDone. Files written to ./dump/');
})();

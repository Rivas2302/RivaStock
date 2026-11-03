import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { KnowledgeClient } from '../src/knowledge/client.ts';
import { hashCentralBatch, inventoryCentral } from '../src/central/inventory.ts';
import { CentralStore, hashBytes } from '../src/central/store.ts';

const LOCAL_PATH = '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/v1/local.pdf';
const MISSING_PATH = '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000003/v1/missing.pdf';
const TRANSFERRING_PATH = '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000004/v1/transferring.pdf';
const IDS = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
];
const WORKER_ID = '40000000-0000-4000-8000-000000000004';

test('daily inventory reports managed files, missing purged originals, and skips in-flight transfers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivastock-central-inventory-'));
  const store = new CentralStore({ storeDirectory: join(directory, 'store'), mirrorDirectory: null });
  await store.initialize();
  const bytes = Buffer.from('%PDF central');
  const sha256 = hashBytes(bytes);
  await store.write(LOCAL_PATH, bytes, sha256);
  const expected = [
    { version_id: IDS[0], relative_path: LOCAL_PATH, sha256, file_size: bytes.byteLength, cloud_purged: true, storage_location: 'local' },
    { version_id: IDS[1], relative_path: MISSING_PATH, sha256: 'b'.repeat(64), file_size: 12, cloud_purged: true, storage_location: 'missing' },
    { version_id: IDS[2], relative_path: TRANSFERRING_PATH, sha256: 'c'.repeat(64), file_size: 12, cloud_purged: false, storage_location: 'transferring' },
  ];
  const reports: unknown[][] = [];
  const statuses: unknown[] = [];
  const client = {
    centralExpected: async () => expected,
    centralInventory: async (_worker: string, entries: unknown[]) => { reports.push(entries); },
    centralStatus: async (_worker: string, status: unknown) => { statuses.push(status); },
  } as unknown as KnowledgeClient;
  try {
    const summary = await inventoryCentral({ client, workerId: WORKER_ID, store, log: () => undefined });
    assert.equal(summary.storeBytes, bytes.byteLength);
    assert.equal(summary.localFiles, 1);
    assert.equal(summary.missingFiles, 1);
    assert.equal(summary.mirrorStatus, 'none');
    assert.deepEqual(reports.flat(), [
      { version_id: IDS[0], sha256, present: true },
      { version_id: IDS[1], sha256: null, present: false },
    ]);
    assert.equal(statuses.length, 1);
    assert.equal((statuses[0] as { files_missing: number }).files_missing, 1);

    const hashed = await hashCentralBatch({
      client: { ...client, centralExpected: async () => [expected[0]] } as unknown as KnowledgeClient,
      workerId: WORKER_ID,
      store,
      state: { lastFullHashAt: 0, offset: 0 },
      now: Date.now(),
      log: () => undefined,
    });
    assert.equal(hashed.finished, true);
    assert.equal(hashed.hashedBytes, bytes.byteLength);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

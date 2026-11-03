import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { KnowledgeClient } from '../src/knowledge/client.ts';
import { transferCentralBatch } from '../src/central/transfer.ts';
import { CentralStore, hashBytes } from '../src/central/store.ts';

const RELATIVE_PATH = '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/v1/manual.pdf';
const VERSION_ID = '30000000-0000-4000-8000-000000000003';
const WORKER_ID = '40000000-0000-4000-8000-000000000004';

test('central transfer verifies a signed download without Content-Length before acknowledging the local write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivastock-central-transfer-'));
  const store = new CentralStore({ storeDirectory: join(directory, 'store'), mirrorDirectory: null });
  await store.initialize();
  const bytes = Buffer.from('%PDF-1.7\nCentral transfer');
  const sha256 = hashBytes(bytes);
  const originalFetch = globalThis.fetch;
  const order: string[] = [];
  // Storage may omit Content-Length for signed downloads; the streamed size is still verified below.
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  const client = {
    centralNext: async () => [{ version_id: VERSION_ID, relative_path: RELATIVE_PATH, sha256,
      file_size: bytes.byteLength, mime_type: 'application/pdf', url: 'https://storage.example/signed' }],
    centralStored: async (_worker: string, _version: string, actualHash: string) => {
      assert.deepEqual(await readFile(store.resolveLocal(RELATIVE_PATH)), bytes);
      assert.equal(actualHash, sha256);
      order.push('ack');
      return { stored: true };
    },
  } as unknown as KnowledgeClient;
  try {
    assert.equal(await transferCentralBatch({ client, workerId: WORKER_ID, store, log: () => undefined }), 1);
    assert.deepEqual(order, ['ack']);
    assert.equal((await store.readManifest())[RELATIVE_PATH].sha256, sha256);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('central transfer reports an incorrect hash to release the server claim and stores no bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivastock-central-transfer-'));
  const store = new CentralStore({ storeDirectory: join(directory, 'store'), mirrorDirectory: null });
  await store.initialize();
  const bytes = Buffer.from('not the expected original');
  const originalFetch = globalThis.fetch;
  const submittedHashes: string[] = [];
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } });
  const client = {
    centralNext: async () => [{ version_id: VERSION_ID, relative_path: RELATIVE_PATH, sha256: 'a'.repeat(64),
      file_size: bytes.byteLength, mime_type: 'application/pdf', url: 'https://storage.example/signed' }],
    centralStored: async (_worker: string, _version: string, actualHash: string) => {
      submittedHashes.push(actualHash);
      return { stored: false, reason: 'hash_mismatch' };
    },
  } as unknown as KnowledgeClient;
  try {
    assert.equal(await transferCentralBatch({ client, workerId: WORKER_ID, store, log: () => undefined }), 0);
    assert.deepEqual(submittedHashes, [hashBytes(bytes)]);
    assert.equal(await store.statLocal(RELATIVE_PATH), null);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

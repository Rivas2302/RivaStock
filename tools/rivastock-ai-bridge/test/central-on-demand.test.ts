import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CentralOriginalRequest, KnowledgeClient } from '../src/knowledge/client.ts';
import { serveCentralRequests } from '../src/central/on-demand.ts';
import { CentralStore, hashBytes } from '../src/central/store.ts';

const OWNER = '10000000-0000-4000-8000-000000000001';
const DOCUMENT = '20000000-0000-4000-8000-000000000002';
const REQUEST = '30000000-0000-4000-8000-000000000003';
const VERSION = '40000000-0000-4000-8000-000000000004';
const WORKER = '50000000-0000-4000-8000-000000000005';
const PATH = OWNER + '/' + DOCUMENT + '/v1/manual.pdf';

test('on-demand serving verifies central bytes, uploads to a signed URL, then marks the request ready', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rivastock-on-demand-'));
  const store = new CentralStore({ storeDirectory: join(directory, 'store'), mirrorDirectory: null });
  await store.initialize();
  const bytes = Buffer.from('%PDF-1.7\nOriginal from central');
  const sha256 = hashBytes(bytes);
  await store.write(PATH, bytes, sha256);
  const request: CentralOriginalRequest = {
    request_id: REQUEST,
    version_id: VERSION,
    relative_path: PATH,
    sha256,
    file_size: bytes.byteLength,
    mime_type: 'application/pdf',
    original_filename: 'manual.pdf',
    cache_path: OWNER + '/' + REQUEST + '/manual.pdf',
    upload_url: 'https://storage.example/signed-upload',
  };
  const order: string[] = [];
  const client = {
    async centralRequests(workerId: string) {
      assert.equal(workerId, WORKER);
      return [request];
    },
    async centralRequestReady(workerId: string, requestId: string, cachePath: string) {
      assert.equal(workerId, WORKER);
      assert.equal(requestId, REQUEST);
      assert.equal(cachePath, request.cache_path);
      order.push('ready');
      return true;
    },
    async centralRequestFailed() {
      assert.fail('A valid original must not be marked failed.');
    },
  } as unknown as KnowledgeClient;
  try {
    const count = await serveCentralRequests({
      client,
      workerId: WORKER,
      store,
      fetcher: async (url, init) => {
        assert.equal(url, request.upload_url);
        assert.equal(init?.method, 'PUT');
        assert.equal(new Headers(init?.headers).get('content-type'), 'application/pdf');
        assert.equal(new Headers(init?.headers).get('x-upsert'), 'false');
        assert.deepEqual(Buffer.from(init?.body as Uint8Array), bytes);
        order.push('uploaded');
        return new Response(null, { status: 200 });
      },
      log: () => undefined,
    });
    assert.equal(count, 1);
    assert.deepEqual(order, ['uploaded', 'ready']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('on-demand serving marks the request failed without uploading when neither central copy verifies', async () => {
  const failed: Array<{ requestId: string; error: string; cachePath?: string }> = [];
  const request: CentralOriginalRequest = {
    request_id: REQUEST,
    version_id: VERSION,
    relative_path: PATH,
    sha256: 'a'.repeat(64),
    file_size: 10,
    mime_type: 'application/pdf',
    original_filename: 'manual.pdf',
    cache_path: OWNER + '/' + REQUEST + '/manual.pdf',
    upload_url: 'https://storage.example/signed-upload',
  };
  const client = {
    async centralRequests() { return [request]; },
    async centralRequestReady() { assert.fail('A missing original cannot become ready.'); },
    async centralRequestFailed(_worker: string, requestId: string, error: string, cachePath?: string) {
      failed.push({ requestId, error, cachePath });
    },
  } as unknown as KnowledgeClient;
  const uploaded: string[] = [];
  const completed = await serveCentralRequests({
    client,
    workerId: WORKER,
    store: { async readVerified() { return null; } },
    fetcher: async (input) => { uploaded.push(String(input)); return new Response(null, { status: 200 }); },
    log: () => undefined,
  });
  assert.equal(completed, 0);
  assert.deepEqual(uploaded, []);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].requestId, REQUEST);
  assert.equal(failed[0].cachePath, undefined);
  assert.doesNotMatch(JSON.stringify(failed), /signed-upload/);
});

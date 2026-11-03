import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CentralStore, hashBytes } from '../src/central/store.ts';

const RELATIVE_PATH = '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/v1/manual.pdf';

async function temporaryStore(withMirror = true) {
  const directory = await mkdtemp(join(tmpdir(), 'rivastock-central-'));
  const store = new CentralStore({
    storeDirectory: join(directory, 'central'),
    mirrorDirectory: withMirror ? join(directory, 'mirror') : null,
  });
  await store.initialize();
  return { directory, store };
}

test('central path validation rejects traversal, absolute paths, and unsupported names', async () => {
  const { directory, store } = await temporaryStore(false);
  try {
    for (const path of [
      '../outside.txt',
      `${RELATIVE_PATH}/../../outside.txt`,
      'C:\\Users\\Riva\\file.pdf',
      '/etc/passwd',
      '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/v1/file with spaces.pdf',
    ]) assert.throws(() => store.resolveLocal(path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('central files use atomic writes, verify SHA-256, restore from mirror, and delete both copies', async () => {
  const { directory, store } = await temporaryStore();
  try {
    const bytes = Buffer.from('%PDF-1.7\nCentral original');
    const sha256 = hashBytes(bytes);
    await assert.rejects(store.write(RELATIVE_PATH, bytes, '0'.repeat(64)), /huella/);
    assert.equal(await store.write(RELATIVE_PATH, bytes, sha256), 'ok');
    assert.deepEqual(await readFile(store.resolveMirror(RELATIVE_PATH) as string), bytes);
    await unlink(store.resolveLocal(RELATIVE_PATH));
    assert.deepEqual(await store.readVerified(RELATIVE_PATH, sha256), bytes);
    assert.deepEqual(await readFile(store.resolveLocal(RELATIVE_PATH)), bytes);
    await store.delete(RELATIVE_PATH);
    assert.equal(await store.statLocal(RELATIVE_PATH), null);
    assert.equal(await store.statMirror(RELATIVE_PATH), null);
    assert.deepEqual(await store.readManifest(), {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('central writes persist the verified file fingerprint and state outside managed paths', async () => {
  const { directory, store } = await temporaryStore(false);
  try {
    const bytes = Buffer.from('verified bytes');
    const hash = hashBytes(bytes);
    await store.write(RELATIVE_PATH, bytes, hash);
    const info = await store.statLocal(RELATIVE_PATH);
    assert.ok(info);
    assert.deepEqual(await store.readManifest(), { [RELATIVE_PATH]: { ...info, sha256: hash } });
    await store.writeHashState({ lastFullHashAt: 1234, offset: 17 });
    assert.deepEqual(await store.readHashState(), { lastFullHashAt: 1234, offset: 17 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

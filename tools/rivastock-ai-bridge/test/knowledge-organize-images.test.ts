import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AIProvider } from '../src/types.ts';
import { withDownloadedOrganizeImages } from '../src/knowledge/organizeImages.ts';

const remoteImage = {
  id: 'IMG1',
  url: 'https://storage.example/signed-image',
  mime_type: 'image/webp',
};

test('passes downloaded image paths to provider options and names files by marker', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'rivastock-organize-test-'));
  let received: Array<{ id: string; path: string }> | undefined;
  const provider: AIProvider = {
    async execute(_input, _signal, _context, options) {
      received = options?.images;
      return { output: 'ok' };
    },
  };
  try {
    await withDownloadedOrganizeImages([remoteImage], async (images, warnings) => {
      assert.deepEqual(warnings, []);
      await provider.execute('organize', new AbortController().signal, '', { images });
      assert.equal(await readFile(images[0].path, 'utf8'), 'webp-data');
    }, {
      temporaryRoot,
      fetchImage: async () => new Response('webp-data', { status: 200, headers: { 'content-type': 'image/webp' } }),
    });
    assert.equal(received?.[0]?.id, 'IMG1');
    assert.match(received?.[0]?.path ?? '', /IMG1\.webp$/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('removes the per-job temporary folder when the provider fails', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'rivastock-organize-test-'));
  try {
    await assert.rejects(withDownloadedOrganizeImages([remoteImage], async () => {
      throw new Error('provider failed');
    }, {
      temporaryRoot,
      fetchImage: async () => new Response('webp-data', { status: 200 }),
    }), /provider failed/);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('continues without an oversized or unavailable capture and reports it', async () => {
  await withDownloadedOrganizeImages([remoteImage], async (images, missingInformation) => {
    assert.deepEqual(images, []);
    assert.deepEqual(missingInformation, ['No se pudo cargar la captura IMG1 para que la IA la analice.']);
  }, { fetchImage: async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1), { status: 200 }) });
});

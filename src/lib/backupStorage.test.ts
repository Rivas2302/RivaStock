import { describe, expect, it } from 'vitest';
import {
  inventorySignature,
  isPathInside,
  normalizeStorageEntry,
  safeObjectRelativePath,
  selectStorageBackupCredentials,
} from '../../scripts/backup-storage.mjs';

describe('verified storage backup helpers', () => {
  it('keeps the opaque API key and legacy Storage JWT separate in memory', () => {
    const opaqueSecret = `sb_${'secret'}_fixture`;
    const output = JSON.stringify([
      { name: 'service_role', type: 'legacy', api_key: 'eyJ-fixture-storage-jwt' },
      { name: 'secondary', type: 'secret', api_key: `sb_${'secret'}_secondary` },
      { name: 'default', type: 'secret', api_key: opaqueSecret },
    ]);

    expect(selectStorageBackupCredentials(output)).toEqual({
      apiKey: opaqueSecret,
      legacyStorageJwt: 'eyJ-fixture-storage-jwt',
    });
    expect(() => selectStorageBackupCredentials(JSON.stringify([
      { name: 'service_role', type: 'legacy', api_key: 'legacy-value' },
    ]))).toThrow('secret-api-key-missing');
  });

  it('recognizes storage folders separately from objects and validates object sizes', () => {
    expect(normalizeStorageEntry('assets', '', { id: null, name: 'products', metadata: null }))
      .toEqual({ folder: 'products' });
    expect(normalizeStorageEntry('assets', 'products', {
      id: 'object-id', name: 'front.jpg', updated_at: '2026-11-02T00:00:00Z', metadata: { size: 123, eTag: 'etag' },
    })).toMatchObject({ object: { bucket: 'assets', path: 'products/front.jpg', size: 123, etag: 'etag' } });
    expect(() => normalizeStorageEntry('assets', '', { id: 'object-id', name: 'missing-size', metadata: {} }))
      .toThrow('storage-object-size-missing');
  });

  it('maps arbitrary object names to safe, bounded local paths while retaining the original route separately', () => {
    const localPath = safeObjectRelativePath('supplier-order-documents', 'folder/unsafe:photo?.png');
    expect(localPath.split(/[\\/]/)).toHaveLength(4);
    expect(localPath).toMatch(/^storage[\\/]~[A-Za-z0-9_-]+[\\/][a-f0-9]{2}[\\/][a-f0-9]{64}\.blob$/);
    expect(localPath).not.toContain('unsafe');
  });

  it('compares remote inventory by bucket, path, size, update time, and ETag', () => {
    const item = { bucket: 'assets', path: 'product/front.jpg', size: 123, updatedAt: '2026-11-02T00:00:00Z', etag: 'etag' };
    expect(inventorySignature([item])).toBe(inventorySignature([{ ...item }]));
    expect(inventorySignature([item])).not.toBe(inventorySignature([{ ...item, size: 124 }]));
    expect(isPathInside('C:\\backups', 'C:\\backups\\storage\\file.blob')).toBe(true);
    expect(isPathInside('C:\\repo', 'C:\\backups')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  inventorySignature,
  isStorageBackupFresh,
  isPathInside,
  listAllStorageObjects,
  normalizeS3Object,
  parseS3Environment,
  safeObjectRelativePath,
  selectS3Credentials,
} from '../../scripts/backup-storage.mjs';

describe('verified storage backup helpers', () => {
  it('reads S3 variables and rejects missing server credentials without formatting their values', () => {
    const values = parseS3Environment('SUPABASE_S3_ACCESS_KEY_ID="access-fixture"\nexport SUPABASE_S3_SECRET_ACCESS_KEY=secret-fixture # local only');
    expect(selectS3Credentials(values)).toEqual({ accessKeyId: 'access-fixture', secretAccessKey: 'secret-fixture' });
    expect(() => selectS3Credentials({})).toThrow('s3-credentials-missing');
  });

  it('normalizes S3 object metadata and rejects incomplete listings', () => {
    expect(normalizeS3Object('assets', {
      Key: 'products/front.jpg', LastModified: new Date('2026-11-02T00:00:00Z'), Size: 123, ETag: 'etag',
    })).toMatchObject({ bucket: 'assets', path: 'products/front.jpg', size: 123, etag: 'etag' });
    expect(() => normalizeS3Object('assets', { Key: 'missing-size' })).toThrow('storage-list-entry-invalid');
  });

  it('lists all S3 buckets and paginates objects with continuation tokens', async () => {
    const seenTokens: Array<string | undefined> = [];
    const client = {
      async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
        if (command.constructor.name === 'ListBucketsCommand') return { Buckets: [{ Name: 'assets' }, { Name: 'knowledge' }] };
        seenTokens.push(command.input.ContinuationToken as string | undefined);
        if (command.input.Bucket === 'knowledge') return { Contents: [], IsTruncated: false };
        if (!command.input.ContinuationToken) return {
          Contents: [{ Key: 'one.webp', Size: 4, ETag: 'one' }],
          IsTruncated: true,
          NextContinuationToken: 'next-page',
        };
        return { Contents: [{ Key: 'two.webp', Size: 8, ETag: 'two' }], IsTruncated: false };
      },
    };

    const result = await listAllStorageObjects(client as never);
    expect(result.buckets).toEqual(['assets', 'knowledge']);
    expect(result.objects.map(({ path, size }) => [path, size])).toEqual([['one.webp', 4], ['two.webp', 8]]);
    expect(seenTokens).toEqual([undefined, 'next-page', undefined]);
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

  it('reuses a verified Storage backup only while it is less than one day old', () => {
    const now = Date.parse('2026-11-05T12:00:00.000Z');
    expect(isStorageBackupFresh('2026-11-04T12:00:01.000Z', now)).toBe(true);
    expect(isStorageBackupFresh('2026-11-04T12:00:00.000Z', now)).toBe(false);
    expect(isStorageBackupFresh('2026-11-05T12:00:01.000Z', now)).toBe(false);
    expect(isStorageBackupFresh('invalid', now)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  extractAssetsPath,
  parseArguments,
  productPhotoPathSet,
} from '../../scripts/backfill-product-thumbnails.mjs';

const projectRef = 'nkfqhuqrgrpfufdymkcr';
const ownerId = '20000000-0000-4000-8000-000000000001';
const productId = '30000000-0000-4000-8000-000000000001';

describe('product photo thumbnail backfill helpers', () => {
  it('collects existing originals and counts stale in-scope references without touching them', () => {
    const existingPath = `${ownerId}/products/${productId}/existing.webp`;
    const missingPath = `${ownerId}/products/${productId}/missing.jpg`;
    const thumbnailPath = `${ownerId}/products/${productId}/existing.thumb.webp`;
    const result = productPhotoPathSet([{
      id: productId,
      user_id: ownerId,
      images: [
        `https://${projectRef}.supabase.co/storage/v1/object/public/assets/${existingPath}`,
        `https://${projectRef}.supabase.co/storage/v1/object/public/assets/${missingPath}`,
        `https://${projectRef}.supabase.co/storage/v1/object/public/assets/${thumbnailPath}`,
        'https://cdn.example.test/photo.webp',
      ],
      image_url: `https://${projectRef}.supabase.co/storage/v1/object/public/assets/${existingPath}`,
    }], projectRef, new Set([existingPath, thumbnailPath]));

    expect(result).toEqual({ paths: new Set([existingPath]), missingReferences: 1 });
    expect(extractAssetsPath(`https://${projectRef}.supabase.co/storage/v1/object/public/assets/${existingPath}?token=x`, projectRef))
      .toBe(existingPath);
  });

  it('requires an exact current storage total before applying and rejects malformed budgets', () => {
    expect(parseArguments([])).toEqual({ apply: false, confirmedStorageBytes: null });
    expect(parseArguments(['--apply', '--confirmed-storage-bytes', '132538148']))
      .toEqual({ apply: true, confirmedStorageBytes: 132538148 });
    expect(() => parseArguments(['--apply'])).toThrow('storage-confirmation-required');
    expect(() => parseArguments(['--apply', '--confirmed-storage-bytes', '-1']))
      .toThrow('storage-confirmation-invalid');
  });
});

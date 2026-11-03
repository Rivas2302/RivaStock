import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProductPhotoStorageUrls,
  getProductPhotoUrls,
  getProductThumbnailPath,
  getProductThumbnailUrl,
  readStoredIds,
  readStoredString,
  writeStoredIds,
} from './productPhotos';

afterEach(() => vi.unstubAllGlobals());

describe('product photo helpers', () => {
  it('deduplicates original photos and derives WebP thumbnails before URL query strings', () => {
    const original = 'https://example.test/storage/v1/object/public/assets/owner/products/p1/image.jpg?token=1';
    const product = { images: [original, original], imageUrl: original };

    expect(getProductPhotoUrls(product)).toEqual([original]);
    expect(getProductThumbnailUrl(original)).toBe('https://example.test/storage/v1/object/public/assets/owner/products/p1/image.thumb.webp?token=1');
    expect(getProductThumbnailPath('owner/products/p1/image.webp')).toBe('owner/products/p1/image.thumb.webp');
    expect(getProductPhotoStorageUrls(product)).toEqual([
      original,
      'https://example.test/storage/v1/object/public/assets/owner/products/p1/image.thumb.webp?token=1',
    ]);
  });

  it('keeps thumbnail paths idempotent', () => {
    expect(getProductThumbnailPath('owner/products/p1/image.thumb.webp')).toBe('owner/products/p1/image.thumb.webp');
    expect(getProductThumbnailUrl('https://example.test/image.thumb.webp')).toBe('https://example.test/image.thumb.webp');
  });

  it('returns fallbacks when localStorage is unavailable or malformed', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    });

    expect(readStoredString('choice', 'public')).toBe('public');
    expect(readStoredIds('favorites')).toEqual([]);
    expect(() => writeStoredIds('favorites', ['p1'])).not.toThrow();
  });

  it('ignores invalid IDs in stored collections', () => {
    vi.stubGlobal('localStorage', { getItem: () => '["p1", 1, null, "p2"]' });
    expect(readStoredIds('recent')).toEqual(['p1', 'p2']);
  });
});

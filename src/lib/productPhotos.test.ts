import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getProductPhotoStorageUrls,
  getProductPhotoUrls,
  getProductPhotoUrlsForSharing,
  getProductThumbnailPath,
  getProductThumbnailUrl,
  normalizeProductStoragePhotoUrl,
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

  it('upgrades only this project’s HTTP Storage URLs and deduplicates scheme and thumbnail variants', () => {
    const projectUrl = 'https://photos.supabase.co';
    const original = 'http://photos.supabase.co/storage/v1/object/public/assets/owner/p1/photo.jpg?token=legacy';
    const product = {
      images: [
        'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/photo.thumb.webp?token=thumb',
        'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/second.webp',
      ],
      imageUrl: original,
    };

    expect(normalizeProductStoragePhotoUrl(original, projectUrl)).toBe(
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/photo.jpg?token=legacy',
    );
    expect(normalizeProductStoragePhotoUrl('http://images.other.test/photo.jpg', projectUrl))
      .toBe('http://images.other.test/photo.jpg');
    expect(getProductPhotoUrlsForSharing(product, projectUrl)).toEqual([
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/photo.jpg?token=legacy',
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/second.webp',
    ]);
  });

  it('keeps case-sensitive Storage object paths distinct while ignoring URL query variants', () => {
    const projectUrl = 'https://photos.supabase.co';
    expect(getProductPhotoUrlsForSharing({
      images: [
        'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/Photo.webp?token=one',
        'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/photo.webp?token=two',
        'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/Photo.jpg?token=three',
      ],
      imageUrl: null,
    }, projectUrl)).toEqual([
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/Photo.webp?token=one',
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/photo.webp?token=two',
    ]);
  });

  it('uses legacy image_url as a fallback and ignores inline legacy duplicates', () => {
    const projectUrl = 'https://photos.supabase.co';
    expect(getProductPhotoUrlsForSharing({ images: [' ', ''], imageUrl: 'data:image/webp;base64,AA==' }, projectUrl))
      .toEqual(['data:image/webp;base64,AA==']);
    expect(getProductPhotoUrlsForSharing({ images: ['https://photos.supabase.co/storage/v1/object/public/assets/p.webp'], imageUrl: 'data:image/webp;base64,AA==' }, projectUrl))
      .toEqual(['https://photos.supabase.co/storage/v1/object/public/assets/p.webp']);
  });

  it('merges a distinct legacy project Storage photo with the canonical array', () => {
    const projectUrl = 'https://photos.supabase.co';
    expect(getProductPhotoUrlsForSharing({
      images: ['https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/array-photo.webp'],
      imageUrl: 'http://photos.supabase.co/storage/v1/object/public/assets/owner/p1/legacy-photo.jpg',
    }, projectUrl)).toEqual([
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/array-photo.webp',
      'https://photos.supabase.co/storage/v1/object/public/assets/owner/p1/legacy-photo.jpg',
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

import { describe, expect, it } from 'vitest';
import { getAllCategoryPhotoUrls, getCategoryPhotoUrls } from './catalogCategoryPhotos';
import type { PublicCatalogProduct } from '../types';

const products = [
  { id: '1', categoryId: 'cables', images: [], imageUrl: null },
  { id: '2', categoryId: 'cables', images: ['https://assets.test/cable.webp'], imageUrl: null },
  { id: '3', categoryId: 'audio', images: ['https://assets.test/audio.webp'], imageUrl: null },
  { id: '4', categoryId: 'other', images: ['https://assets.test/audio.webp'], imageUrl: null },
] as unknown as PublicCatalogProduct[];

describe('catalog category photos', () => {
  it('uses the first visible product with a photo and an explicit override when present', () => {
    expect(getCategoryPhotoUrls('cables', products)).toEqual(['https://assets.test/cable.webp']);
    expect(getCategoryPhotoUrls('cables', products, 'https://assets.test/custom.webp')).toEqual(['https://assets.test/custom.webp']);
  });

  it('supports disabling category photos and builds a unique four-photo mosaic', () => {
    expect(getCategoryPhotoUrls('cables', products, null, false)).toEqual([]);
    expect(getAllCategoryPhotoUrls(products)).toEqual(['https://assets.test/cable.webp', 'https://assets.test/audio.webp']);
  });
});

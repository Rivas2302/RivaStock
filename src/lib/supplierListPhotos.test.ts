import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteFromStorage, uploadToStorage, assertStorageUploadAllowed, optimizeUploadImage } = vi.hoisted(() => ({
  deleteFromStorage: vi.fn(),
  uploadToStorage: vi.fn(),
  assertStorageUploadAllowed: vi.fn(),
  optimizeUploadImage: vi.fn(),
}));

vi.mock('./db', () => ({ deleteFromStorage, uploadToStorage }));
vi.mock('./platformStorage', () => ({ assertStorageUploadAllowed }));
vi.mock('./imageOptimization', () => ({
  imageFileExtension: () => 'webp',
  optimizeUploadImage,
}));
vi.mock('./productPhotos', () => ({
  getProductThumbnailPath: (path: string) => path.replace(/\.webp$/, '.thumb.webp'),
  PRODUCT_PHOTO_CACHE_CONTROL: '3600',
}));

import { uploadSupplierListProductPhoto } from './supplierListPhotos';

describe('supplier list product photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    optimizeUploadImage.mockImplementation(async (source: File) => source.type === 'image/webp'
      ? source
      : new File(['optimized'], 'product.webp', { type: 'image/webp' }));
    uploadToStorage.mockResolvedValue('https://storage.example/assets/product.webp');
    vi.stubGlobal('crypto', { randomUUID: () => 'photo-id' });
  });

  it('stores an optimized WebP original and thumbnail in the product assets path', async () => {
    const file = new File(['raw'], 'source.jpg', { type: 'image/jpeg' });
    const url = await uploadSupplierListProductPhoto(file, 'owner-1', 'product-1');

    expect(url).toBe('https://storage.example/assets/product.webp');
    expect(assertStorageUploadAllowed).toHaveBeenCalledWith('assets', expect.any(Number));
    expect(uploadToStorage).toHaveBeenCalledTimes(2);
    expect(uploadToStorage.mock.calls[0][0]).toMatch(/^owner-1\/products\/product-1\/\d+_photo-id\.webp$/);
    expect(uploadToStorage.mock.calls[1][0]).toMatch(/\.thumb\.webp$/);
    expect(uploadToStorage.mock.calls.every(call => call[1].type === 'image/webp')).toBe(true);
  });

  it('removes the uploaded original if the thumbnail upload fails', async () => {
    uploadToStorage.mockResolvedValueOnce('https://storage.example/assets/product.webp').mockRejectedValueOnce(new Error('thumbnail failed'));
    await expect(uploadSupplierListProductPhoto(new File(['raw'], 'source.jpg', { type: 'image/jpeg' }), 'owner-1', 'product-1'))
      .rejects.toThrow('thumbnail failed');
    expect(deleteFromStorage).toHaveBeenCalledTimes(2);
  });

  it('rejects non-images and files larger than 10 MB before uploading', async () => {
    await expect(uploadSupplierListProductPhoto(new File(['x'], 'notes.txt', { type: 'text/plain' }), 'owner-1', 'product-1'))
      .rejects.toThrow('La foto debe ser una imagen de hasta 10 MB.');
    expect(uploadToStorage).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  copyThenShareProductPhotos,
  createProductPhotoShareText,
  fetchProductPhotoFiles,
  isFileSharingSupported,
} from './productPhotoSharing';

describe('product photo sharing', () => {
  it('builds one line per selected product with price and only published catalog links', () => {
    expect(createProductPhotoShareText([
      { productName: 'Cámara WiFi', priceText: '$ 15.000', catalogUrl: 'https://shop.test/catalogo/shop/camera' },
      { productName: 'Auriculares', priceText: '$ 9.000' },
    ])).toBe('Cámara WiFi — $ 15.000 — https://shop.test/catalogo/shop/camera\nAuriculares — $ 9.000');
  });

  it('downloads image blobs and names files with safe WebP or JPG extensions', async () => {
    const fetchImage = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob(['webp'], { type: 'image/webp' })))
      .mockResolvedValueOnce(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));

    const result = await fetchProductPhotoFiles([
      { productName: 'Cámara WiFi 360', imageUrls: ['https://cdn.test/camera.webp'] },
      { productName: 'Auriculares', imageUrls: ['https://cdn.test/headphones.jpg'] },
    ], fetchImage);

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(result.failedCount).toBe(0);
    expect(result.files.map((file) => [file.name, file.type])).toEqual([
      ['camara-wifi-360-1.webp', 'image/webp'],
      ['auriculares-1.jpg', 'image/jpeg'],
    ]);
  });

  it('keeps downloadable photos when another photo request fails', async () => {
    const fetchImage = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob(['webp'], { type: 'image/webp' })))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await fetchProductPhotoFiles([
      { productName: 'Cable', imageUrls: ['https://cdn.test/cable.webp', 'https://cdn.test/cable-2.webp'] },
    ], fetchImage);

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('cable-1.webp');
    expect(result.failedCount).toBe(1);
  });

  it('reads inline image data without issuing a network request', async () => {
    const fetchImage = vi.fn();
    const result = await fetchProductPhotoFiles([
      { productName: 'Inline', imageUrls: ['data:image/webp;base64,UklGRg=='] },
    ], fetchImage);

    expect(fetchImage).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].type).toBe('image/webp');
  });

  it('checks file sharing support and copies text before opening the share sheet', async () => {
    const file = new File(['photo'], 'product-1.webp', { type: 'image/webp' });
    const calls: string[] = [];
    const navigatorApi = {
      canShare: vi.fn(() => true),
      share: vi.fn(async () => { calls.push('share'); }),
    };
    const clipboard = { writeText: vi.fn(async () => { calls.push('copy'); }) };
    const onCopied = vi.fn(() => { calls.push('toast'); });

    expect(isFileSharingSupported(navigatorApi, [file])).toBe(true);
    await expect(copyThenShareProductPhotos('Cámara — $ 10.000', [file], navigatorApi, clipboard, onCopied))
      .resolves.toBe('shared');
    expect(calls).toEqual(['copy', 'toast', 'share']);
    expect(navigatorApi.share).toHaveBeenCalledWith({ files: [file], text: 'Cámara — $ 10.000' });
  });

  it('offers fallback when files cannot be shared or clipboard access fails', async () => {
    const file = new File(['photo'], 'product-1.webp', { type: 'image/webp' });
    const navigatorApi = { canShare: vi.fn(() => false), share: vi.fn() };
    const clipboard = { writeText: vi.fn(async () => undefined) };

    await expect(copyThenShareProductPhotos('text', [file], navigatorApi, clipboard)).resolves.toBe('unsupported');
    expect(navigatorApi.share).not.toHaveBeenCalled();

    navigatorApi.canShare = vi.fn(() => true);
    clipboard.writeText = vi.fn(async () => { throw new Error('clipboard denied'); });
    await expect(copyThenShareProductPhotos('text', [file], navigatorApi, clipboard)).resolves.toBe('clipboard-failed');
    expect(navigatorApi.share).not.toHaveBeenCalled();
  });
});

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

    const files = await fetchProductPhotoFiles([
      { productName: 'Cámara WiFi 360', imageUrls: ['https://cdn.test/camera.webp'] },
      { productName: 'Auriculares', imageUrls: ['https://cdn.test/headphones.jpg'] },
    ], fetchImage);

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ['camara-wifi-360-1.webp', 'image/webp'],
      ['auriculares-1.jpg', 'image/jpeg'],
    ]);
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

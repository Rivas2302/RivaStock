import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitImageDimensions, hasPngAnimation, imageFileExtension, optimizeCatalogCover, optimizeSupplierCatalogPhoto, optimizeUploadImage } from './imageOptimization';

afterEach(() => vi.unstubAllGlobals());
describe('image upload optimization', () => {
  it('preserves aspect ratio and never upscales', () => {
    expect(fitImageDimensions(4000, 2000)).toEqual({ width: 1600, height: 800 });
    expect(fitImageDimensions(600, 1200)).toEqual({ width: 600, height: 1200 });
  });
  it('does not mislabel JPEG or PNG originals as WebP', () => {
    expect(imageFileExtension({ type: 'image/jpeg', name: 'photo.webp' })).toBe('jpg');
    expect(imageFileExtension({ type: 'image/png', name: 'photo.jpg' })).toBe('png');
  });
  it('keeps the original when decoding fails or bitmap is unavailable', async () => {
    const file = new File(['original'], 'photo.jpg', { type: 'image/jpeg' });
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await optimizeUploadImage(file)).toBe(file);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    expect(await optimizeUploadImage(file)).toBe(file);
  });
  it('optimizes a JPEG larger than 2 MB when the browser can decode it', async () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'large-photo.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(1024)], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const result = await optimizeUploadImage(file);
    expect(file.size).toBeGreaterThan(2 * 1024 * 1024);
    expect(result.type).toBe('image/webp');
    expect(result.size).toBe(1024);
    expect(close).toHaveBeenCalledOnce();
  });
  it('creates a forced WebP thumbnail even when encoding is larger than its source', async () => {
    const file = new File(['source'], 'photo.png', { type: 'image/png' });
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(1024)], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2400, height: 1200, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const thumbnail = await optimizeUploadImage(file, 480, { forceWebP: true });

    expect(thumbnail).not.toBe(file);
    expect(thumbnail.type).toBe('image/webp');
    expect(thumbnail.name).toBe('photo.webp');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 240);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['image/png', 'image/webp'])('accepts only smaller genuine WebP blobs (%s)', async type => {
    const file = new File(['original image bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob(['small'], { type })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const result = await optimizeUploadImage(file);
    expect(result.type).toBe(type === 'image/webp' ? type : file.type);
    expect(result.name).toBe(type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('leaves SVG intact', async () => {
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    expect(await optimizeUploadImage(file)).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });
  it('compresses a catalog cover under the configured 300 KB ceiling', async () => {
    const file = new File([new Uint8Array(900_000)], 'cover.png', { type: 'image/png' });
    const close = vi.fn();
    let calls = 0;
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => {
      calls += 1;
      fn(new Blob([new Uint8Array(calls === 1 ? 350_000 : 250_000)], { type: 'image/webp' }));
    } };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const optimized = await optimizeCatalogCover(file);
    expect(optimized.type).toBe('image/webp');
    expect(optimized.size).toBeLessThanOrEqual(300_000);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('compresses a supplier photo to genuine WebP within the 60 KB limit', async () => {
    const file = new File([new Uint8Array(200_000)], 'supplier.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(58_000)], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1200, height: 900, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const optimized = await optimizeSupplierCatalogPhoto(file);

    expect(optimized.type).toBe('image/webp');
    expect(optimized.size).toBeLessThanOrEqual(60_000);
    expect(optimized.name).toBe('supplier.webp');
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('rejects supplier formats that are not JPEG, PNG or WebP', async () => {
    const file = new File(['gif'], 'supplier.gif', { type: 'image/gif' });
    await expect(optimizeSupplierCatalogPhoto(file)).rejects.toThrow();
  });
  it('preserves animated WebP and APNG rather than flattening frames', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const webp = new File(['animated'], 'animation.webp', { type: 'image/webp' });
    expect(await optimizeUploadImage(webp)).toBe(webp);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]);
    expect(hasPngAnimation(bytes.buffer)).toBe(true);
    const apng = new File([bytes], 'animation.png', { type: 'image/png' });
    expect(await optimizeUploadImage(apng)).toBe(apng);
    expect(decode).not.toHaveBeenCalled();
  });
});
